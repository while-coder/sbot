/**
 * 插件配置项描述。供 admin 端依据 schema 自动渲染配置表单，
 * channel 插件与 wiki 插件共用同一套字段类型。
 */
export enum ConfigFieldType {
  String = 'string',
  Password = 'password',
  Boolean = 'boolean',
  Number = 'number',
  Select = 'select',
  /** Renders a button → QR code image → waits for scan result. */
  QRCode = 'qrcode',
}

export interface ConfigField {
  label: string;
  type: ConfigFieldType;
  required?: boolean;
  description?: string;
  default?: string | boolean | number;
  /** only for type: 'select' */
  options?: Array<{ label: string; value: string }>;
}
