export const BUILT_IN_ICON_PROVIDERS = ["thesvg", "selfhst", "dashboardIcons"] as const;

export type BuiltInIconProvider = (typeof BUILT_IN_ICON_PROVIDERS)[number];

export interface BuiltInIconSourceSetting {
  enabled: boolean;
  variantsEnabled: boolean;
}

export type BuiltInIconSourceSettings = Record<BuiltInIconProvider, BuiltInIconSourceSetting>;
export type BuiltInIconSourceSettingsPatch = Partial<Record<BuiltInIconProvider, Partial<BuiltInIconSourceSetting>>>;
type LooseBuiltInIconSourceSettingsPatch = Partial<Record<BuiltInIconProvider, {
  enabled?: boolean | undefined;
  variantsEnabled?: boolean | undefined;
} | undefined>>;

export const DEFAULT_BUILT_IN_ICON_SOURCES: BuiltInIconSourceSettings = {
  thesvg: { enabled: true, variantsEnabled: true },
  selfhst: { enabled: true, variantsEnabled: true },
  dashboardIcons: { enabled: true, variantsEnabled: true },
};

export function hasEnabledBuiltInIconSource(settings: BuiltInIconSourceSettings): boolean {
  return BUILT_IN_ICON_PROVIDERS.some((provider) => settings[provider].enabled);
}

export function mergeBuiltInIconSourceSettings(
  base: BuiltInIconSourceSettings = DEFAULT_BUILT_IN_ICON_SOURCES,
  patch?: BuiltInIconSourceSettingsPatch,
): BuiltInIconSourceSettings {
  return Object.fromEntries(BUILT_IN_ICON_PROVIDERS.map((provider) => [
    provider,
    {
      ...base[provider],
      ...patch?.[provider],
    },
  ])) as BuiltInIconSourceSettings;
}

export function cleanBuiltInIconSourceSettingsPatch(
  patch?: LooseBuiltInIconSourceSettingsPatch,
): BuiltInIconSourceSettingsPatch | undefined {
  if (!patch) return undefined;
  const entries = BUILT_IN_ICON_PROVIDERS.flatMap((provider) => {
    const value = patch[provider];
    if (!value) return [];
    const cleanValue: Partial<BuiltInIconSourceSetting> = {};
    if (value.enabled !== undefined) cleanValue.enabled = value.enabled;
    if (value.variantsEnabled !== undefined) cleanValue.variantsEnabled = value.variantsEnabled;
    return Object.keys(cleanValue).length > 0 ? [[provider, cleanValue] as const] : [];
  });
  return entries.length > 0 ? Object.fromEntries(entries) as BuiltInIconSourceSettingsPatch : undefined;
}
