// errors.js — типизированные ошибки патчинга.
// Относительный путь: ./emulator-core/patching/errors.js

export class PatchError extends Error {
  code: string;
  detail: any;

  constructor(code: string, message: string, detail: any = {}) {
    super(message);
    this.name = "PatchError";
    this.code = code;
    this.detail = detail;
  }
}

export const PatchErrorCode = {
  BASE_MISMATCH: "PATCH_BASE_MISMATCH",
  EXPECT_FAILED: "PATCH_EXPECT_FAILED",
  OVERLAP: "PATCH_OVERLAP",
  NO_SPACE: "PATCH_NO_SPACE",
  UNKNOWN_SYMBOL: "PATCH_UNKNOWN_SYMBOL",
  BAD_SET: "PATCH_BAD_SET",
  BAD_WRITE: "PATCH_BAD_WRITE",
  BAD_ROUTINE: "PATCH_BAD_ROUTINE",
  BAD_BYTES: "PATCH_BAD_BYTES",
  BAD_JUMP: "PATCH_BAD_JUMP",
  BAD_HEX: "PATCH_BAD_HEX",
};

export default PatchError;
