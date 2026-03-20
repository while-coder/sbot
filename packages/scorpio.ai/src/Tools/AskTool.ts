import { z } from "zod";
import { DynamicStructuredTool } from "@langchain/core/tools";
import { createSuccessResult, createTextContent, MCPToolResult } from "./types";

// ── Question Types ──────────────────────────────────────────────────────────

interface AskQuestionBase {
  label: string;
}

export interface RadioQuestion extends AskQuestionBase {
  type: "radio";
  options: string[];
  allowCustom?: boolean;
}

export interface CheckboxQuestion extends AskQuestionBase {
  type: "checkbox";
  options: string[];
  allowCustom?: boolean;
}

export interface InputQuestion extends AskQuestionBase {
  type: "input";
  placeholder?: string;
}

export type AskQuestion = RadioQuestion | CheckboxQuestion | InputQuestion;

export interface AskToolParams {
  title?: string;
  questions: AskQuestion[];
}

export type AskResponse = Record<string, string | string[]>;

export type AskUserFn = (params: AskToolParams) => Promise<AskResponse>;

// ── Zod Schema ──────────────────────────────────────────────────────────────

const RadioSchema = z.object({
  type: z.literal("radio"),
  label: z.string().describe("Question label displayed to the user"),
  options: z.array(z.string()).min(2).describe("Choices for single selection"),
  allowCustom: z.boolean().optional().describe("Show an extra 'Other' option with a text input"),
});

const CheckboxSchema = z.object({
  type: z.literal("checkbox"),
  label: z.string().describe("Question label displayed to the user"),
  options: z.array(z.string()).min(1).describe("Choices for multiple selection"),
  allowCustom: z.boolean().optional().describe("Show an extra 'Other' option with a text input"),
});

const InputSchema = z.object({
  type: z.literal("input"),
  label: z.string().describe("Question label displayed to the user"),
  placeholder: z.string().optional().describe("Placeholder text for the input field"),
});

const AskSchema = z.object({
  title: z.string().optional().describe("Optional title for the question dialog"),
  questions: z.array(
    z.discriminatedUnion("type", [RadioSchema, CheckboxSchema, InputSchema])
  ).min(1).describe("Array of questions to present to the user"),
});

// ── Factory ─────────────────────────────────────────────────────────────────

export function createAskTool(askFn: AskUserFn, description: string): DynamicStructuredTool {
  return new DynamicStructuredTool({
    name: "ask",
    description,
    schema: AskSchema as any,
    func: async (params: any): Promise<MCPToolResult> => {
      const response = await askFn(params as AskToolParams);
      return createSuccessResult(createTextContent(JSON.stringify(response)));
    },
  });
}
