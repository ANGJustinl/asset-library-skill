import { describe, expect, it } from "vitest";
import { shouldPreprocessRasterImage } from "../src/tools/prepare-raster-image.js";

describe("@caixu/ocr-mcp raster image preparation", () => {
  const config = {
    enabled: true,
    thresholdBytes: 1_000_000,
    maxWidth: 1600
  };

  it("preprocesses large raster images", () => {
    expect(
      shouldPreprocessRasterImage({
        mimeType: "image/png",
        sizeBytes: 2_900_000,
        config
      })
    ).toBe(true);
    expect(
      shouldPreprocessRasterImage({
        mimeType: "image/jpeg",
        sizeBytes: 1_500_000,
        config
      })
    ).toBe(true);
  });

  it("skips small raster files and non-raster types", () => {
    expect(
      shouldPreprocessRasterImage({
        mimeType: "image/png",
        sizeBytes: 400_000,
        config
      })
    ).toBe(false);
    expect(
      shouldPreprocessRasterImage({
        mimeType: "application/pdf",
        sizeBytes: 2_900_000,
        config
      })
    ).toBe(false);
  });
});
