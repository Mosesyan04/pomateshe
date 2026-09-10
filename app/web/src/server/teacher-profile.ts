import { prisma } from "./db";
import { withTenantContext } from "./tenant-context";
import { saveFile } from "../lib/files/local-disk-storage";
import { detectImageType } from "../lib/files/detect-image-type";
import { isValidZoomUrl } from "../lib/zoom/validate-link";

const MAX_AVATAR_BYTES = 5 * 1024 * 1024; // product constant, not architecture

export interface PublicTeacherProfile {
  slug: string;
  displayName: string;
  bio: string | null;
  subjects: string[];
  avatarUrl: string | null;
  contactInfo: string | null;
  defaultLessonPriceCents: number | null;
  currency: string;
}

/**
 * No withTenantContext — teacher_profiles' `public_read` policy (added in the
 * 20260910170000 migration, docs/MULTI_TENANCY.md §4.3) permits this SELECT with no tenant
 * context at all. The `select` below is deliberately narrow: these are the only columns the
 * policy is meant to expose publicly — zoomPersonalLink and publicPageSettings must never be
 * added here without a separate decision, since RLS itself doesn't gate individual columns.
 */
export async function getPublicTeacherProfile(slug: string): Promise<PublicTeacherProfile | null> {
  const profile = await prisma.teacherProfile.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      displayName: true,
      bio: true,
      subjects: true,
      avatarStorageKey: true,
      contactInfo: true,
      defaultLessonPriceCents: true,
      currency: true,
    },
  });
  if (!profile) return null;

  return {
    slug: profile.slug,
    displayName: profile.displayName,
    bio: profile.bio,
    subjects: profile.subjects,
    avatarUrl: profile.avatarStorageKey ? `/api/public/avatars/${profile.id}` : null,
    contactInfo: profile.contactInfo,
    defaultLessonPriceCents: profile.defaultLessonPriceCents,
    currency: profile.currency,
  };
}

/** For the teacher's own edit form — the full set of editable fields, via the owner-scoped
 *  tenant context (not the public_read policy). */
export async function getTeacherProfileForEditing(teacherId: string) {
  return withTenantContext({ teacherId }, (tx) =>
    tx.teacherProfile.findUniqueOrThrow({
      where: { id: teacherId },
      select: {
        slug: true,
        displayName: true,
        bio: true,
        subjects: true,
        contactInfo: true,
        defaultLessonPriceCents: true,
        currency: true,
        avatarStorageKey: true,
        zoomPersonalLink: true,
      },
    }),
  );
}

export interface AvatarLookup {
  storageKey: string;
  mimeType: string;
}

/** For the public avatar route handler — same public_read policy as above. */
export async function getTeacherAvatarForServing(teacherId: string): Promise<AvatarLookup | null> {
  const profile = await prisma.teacherProfile.findUnique({
    where: { id: teacherId },
    select: { avatarStorageKey: true, avatarMimeType: true },
  });
  if (!profile || !profile.avatarStorageKey || !profile.avatarMimeType) return null;
  return { storageKey: profile.avatarStorageKey, mimeType: profile.avatarMimeType };
}

export interface UpdateTeacherProfileInput {
  teacherId: string;
  displayName: string;
  slug: string;
  bio?: string;
  subjects: string[];
  contactInfo?: string;
  defaultLessonPriceCents?: number;
  /** Explicit null (not just omitted) clears a previously-set link — see the form's "Убрать
   *  ссылку" checkbox in teacher/profile/page.tsx. */
  zoomPersonalLink?: string | null;
  avatar?: { data: Buffer } | null;
}

export async function updateTeacherProfile(input: UpdateTeacherProfileInput) {
  if (input.zoomPersonalLink && !isValidZoomUrl(input.zoomPersonalLink)) {
    throw new Error("Ссылка не похожа на Zoom (ожидается https://...zoom.us/...).");
  }

  return withTenantContext({ teacherId: input.teacherId }, async (tx) => {
    let avatarFields: { avatarStorageKey: string; avatarMimeType: string } | undefined;

    if (input.avatar) {
      if (input.avatar.data.byteLength > MAX_AVATAR_BYTES) {
        throw new Error("Файл слишком большой (максимум 5 МБ).");
      }
      const detectedType = detectImageType(input.avatar.data);
      if (!detectedType) {
        throw new Error("Файл не распознан как изображение (поддерживаются JPEG, PNG, WebP).");
      }
      // Fixed key, not a new id per upload — a new avatar simply overwrites the old file, no
      // orphaned files to clean up (unlike homework's MaterialFile rows, there's exactly one
      // avatar per teacher, so there is no separate row to track).
      const storageKey = `avatars/${input.teacherId}`;
      await saveFile(storageKey, input.avatar.data);
      avatarFields = { avatarStorageKey: storageKey, avatarMimeType: detectedType };
    }

    return tx.teacherProfile.update({
      where: { id: input.teacherId },
      data: {
        displayName: input.displayName,
        slug: input.slug,
        bio: input.bio,
        subjects: input.subjects,
        contactInfo: input.contactInfo,
        defaultLessonPriceCents: input.defaultLessonPriceCents,
        // undefined (field omitted from formData) leaves the stored value untouched;
        // explicit null clears it — Prisma treats these differently, matching the interface
        // comment above.
        ...(input.zoomPersonalLink !== undefined ? { zoomPersonalLink: input.zoomPersonalLink } : {}),
        ...avatarFields,
      },
    });
  });
}
