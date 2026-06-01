import type { MessageKey } from "@/i18n/messages";

type Translate = (key: MessageKey, params?: Record<string, string | number>) => string;

const IMPORT_MESSAGE_KEYS: Record<string, MessageKey> = {
  BILLING_CYCLE_INVALID: "import.error.billingCycleInvalid",
  IMPORT_CONFIDENCE_INVALID: "import.error.confidenceInvalid",
  IMPORT_ERROR_UNRECOGNIZED_FILE: "import.error.unrecognizedFile",
  IMPORT_ERROR_WORKER_PARSE_FAILED: "import.error.workerParseFailed",
  IMPORT_ERROR_WORKER_UNSUPPORTED: "import.error.workerUnsupported",
  IMPORT_KEY_REQUIRED: "import.error.keyRequired",
  IMPORT_SKIP_INDEX_INVALID: "import.error.skipIndexInvalid",
  IMPORT_SOURCE_ID_DUPLICATE: "import.error.sourceIdDuplicate",
  IMPORT_SOURCE_ID_INVALID: "import.error.sourceIdInvalid",
  IMPORT_SOURCE_INVALID: "import.error.sourceInvalid",
  SUBSCRIPTION_STATUS_INVALID: "import.error.statusInvalid",
  IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS: "import.warning.currencySymbolAmbiguous",
  IMPORT_WARNING_INVALID_WEBSITE: "import.warning.invalidWebsite",
  IMPORT_WARNING_LOW_CONFIDENCE_KEY: "import.warning.lowConfidenceKey",
  IMPORT_WARNING_LOW_CONFIDENCE_NAME_MATCHED: "import.warning.lowConfidenceNameMatched",
  IMPORT_WARNING_WALLOS_CURRENCY_ID_ONLY: "import.warning.wallosCurrencyIdOnly",
  IMPORT_WARNING_WALLOS_DISPLAY_LOW_CONFIDENCE: "import.warning.wallosDisplayLowConfidence",
  IMPORT_WARNING_WALLOS_EXTERNAL_LOGO: "import.warning.wallosExternalLogo",
  IMPORT_WARNING_WALLOS_MISSING_LOGO_FILE: "import.warning.wallosMissingLogoFile",
  IMPORT_WARNING_WALLOS_NOTIFY_DISABLED: "import.warning.wallosNotifyDisabled",
  IMPORT_WARNING_WALLOS_ONE_TIME: "import.warning.wallosOneTime",
  IMPORT_WARNING_WALLOS_UNKNOWN_CYCLE: "import.warning.wallosUnknownCycle",
};

const IMPORT_DATE_FIELD_KEYS: Record<string, MessageKey> = {
  wallosDueDate: "import.field.wallosDueDate",
  wallosStartDate: "import.field.wallosStartDate",
};

export function formatImportMessage(message: string, t: Translate): string {
  const parts = message.split("|");
  const code = parts[0] ?? "";
  if (code === "IMPORT_WARNING_FOR_SUBSCRIPTION") {
    const name = parts[1] ?? "";
    const nested = parts.slice(2).join("|");
    return t("import.warning.forSubscription", {
      name,
      warning: nested ? formatImportMessage(nested, t) : "",
    });
  }
  if (code === "IMPORT_WARNING_DATE_INVALID") {
    const fieldKey = parts[1] ?? "";
    const fieldMessageKey = IMPORT_DATE_FIELD_KEYS[fieldKey];
    const field = fieldMessageKey ? t(fieldMessageKey) : fieldKey;
    return t("import.warning.dateInvalid", { field, fallback: parts[2] ?? "" });
  }
  if (code === "IMPORT_WARNING_CURRENCY_SYMBOL_AMBIGUOUS") {
    return t("import.warning.currencySymbolAmbiguous", { symbol: parts[1] ?? "", currency: parts[2] ?? "" });
  }
  const key = IMPORT_MESSAGE_KEYS[code];
  return key ? t(key) : message;
}
