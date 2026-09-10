import { describe, it, expect } from "vitest";
import { detectImageType } from "../files/detect-image-type";

describe("detectImageType", () => {
  it("recognizes a JPEG signature", () => {
    const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
    expect(detectImageType(bytes)).toBe("image/jpeg");
  });

  it("recognizes a PNG signature", () => {
    const bytes = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
    expect(detectImageType(bytes)).toBe("image/png");
  });

  it("recognizes a WebP signature (RIFF....WEBP)", () => {
    const bytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50,
    ]);
    expect(detectImageType(bytes)).toBe("image/webp");
  });

  it("rejects a renamed executable — extension lies, magic bytes don't", () => {
    // MZ header (Windows PE), the classic "renamed .exe as .jpg" attack this exists to catch.
    const bytes = Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00]);
    expect(detectImageType(bytes)).toBeNull();
  });

  it("rejects plain text", () => {
    expect(detectImageType(Buffer.from("not an image"))).toBeNull();
  });

  it("rejects a RIFF file that isn't WebP (e.g. a WAV file)", () => {
    const bytes = Buffer.from([
      0x52, 0x49, 0x46, 0x46, 0x00, 0x00, 0x00, 0x00, 0x57, 0x41, 0x56, 0x45,
    ]);
    expect(detectImageType(bytes)).toBeNull();
  });

  it("rejects buffers too short to contain any known signature", () => {
    expect(detectImageType(Buffer.from([0xff, 0xd8]))).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});
