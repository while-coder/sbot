import { registerMemorySaverProvider } from "scorpio.saver";
import { registerFileSaverProvider } from "scorpio.saver.file";
import { registerSqliteSaverProvider } from "scorpio.saver.sqlite";

let registered = false;

/** 在应用组合入口显式注册内置 Saver Provider。 */
export function registerBuiltInSaverProviders(): void {
  if (registered) return;
  registerMemorySaverProvider();
  registerFileSaverProvider();
  registerSqliteSaverProvider();
  registered = true;
}
