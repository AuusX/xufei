import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useCroppedImageUpload } from "./use-cropped-image-upload";

const mocks = vi.hoisted(() => ({
  onChange: vi.fn(),
  uploadImageDataUrl: vi.fn(),
  uploadImageFile: vi.fn(),
  validateImageFileForUpload: vi.fn(),
}));

vi.mock("@/lib/upload-image", () => ({
  uploadImageDataUrl: mocks.uploadImageDataUrl,
  uploadImageFile: mocks.uploadImageFile,
  validateImageFileForUpload: mocks.validateImageFileForUpload,
}));

function UploadHarness() {
  const upload = useCroppedImageUpload({
    kind: "logo",
    filename: "logo.png",
    onChange: mocks.onChange,
  });

  return (
    <>
      <input data-testid="file" type="file" onChange={upload.handleFileUpload} />
      {upload.cropDialogOpen && <span>crop-open</span>}
      <span data-testid="status">{upload.uploadStatus}</span>
    </>
  );
}

describe("useCroppedImageUpload", () => {
  beforeEach(() => {
    mocks.onChange.mockReset();
    mocks.uploadImageDataUrl.mockReset();
    mocks.uploadImageFile.mockReset();
    mocks.validateImageFileForUpload.mockReset();
    mocks.validateImageFileForUpload.mockReturnValue(null);
    mocks.uploadImageFile.mockResolvedValue({ url: "/api/app/assets/svg-logo" });
  });

  it("uploads SVG files directly without opening the crop dialog", async () => {
    render(<UploadHarness />);

    const file = new File(
      [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"></svg>`],
      "logo.svg",
      { type: "image/svg+xml" },
    );
    fireEvent.change(screen.getByTestId("file"), { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.uploadImageFile).toHaveBeenCalledWith({
        file,
        kind: "logo",
        filename: "logo.svg",
      });
    });

    expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(screen.queryByText("crop-open")).toBeNull();

    await waitFor(() => {
      expect(mocks.onChange).toHaveBeenCalledWith("/api/app/assets/svg-logo");
    });
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("uploads ICO files directly without opening the crop dialog", async () => {
    render(<UploadHarness />);

    const file = new File(["\0\0\x01\0"], "logo.ico", { type: "image/x-icon" });
    fireEvent.change(screen.getByTestId("file"), { target: { files: [file] } });

    await waitFor(() => {
      expect(mocks.uploadImageFile).toHaveBeenCalledWith({
        file,
        kind: "logo",
        filename: "logo.ico",
      });
    });

    expect(mocks.uploadImageDataUrl).not.toHaveBeenCalled();
    expect(screen.queryByText("crop-open")).toBeNull();
  });
});
