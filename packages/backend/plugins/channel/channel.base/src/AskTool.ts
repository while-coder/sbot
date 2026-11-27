// ── Question Types ──────────────────────────────────────────────────────────

export enum AskQuestionType {
  Radio    = "radio",
  Checkbox = "checkbox",
  Input    = "input",
}

interface AskQuestionBase {
  label: string;
}

export interface RadioQuestion extends AskQuestionBase {
  type: AskQuestionType.Radio;
  options: string[];
}

export interface CheckboxQuestion extends AskQuestionBase {
  type: AskQuestionType.Checkbox;
  options: string[];
}

export interface InputQuestion extends AskQuestionBase {
  type: AskQuestionType.Input;
  placeholder?: string;
}

export type AskQuestion = RadioQuestion | CheckboxQuestion | InputQuestion;

export interface AskToolParams {
  title?: string;
  questions: AskQuestion[];
}

export type AskResponse = Record<string, string | string[]>;
