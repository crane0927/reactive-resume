import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createGateway, generateText, streamText } from "ai";
import { createOllama } from "ai-sdk-ollama";
import { match } from "ts-pattern";
import z, { flattenError, ZodError } from "zod";
import { createZhipu } from "zhipu-ai-provider";
import docxParserSystemPrompt from "@/integrations/ai/prompts/docx-parser-system.md?raw";
import docxParserUserPrompt from "@/integrations/ai/prompts/docx-parser-user.md?raw";
import markdownParserSystemPrompt from "@/integrations/ai/prompts/markdown-parser-system.md?raw";
import markdownParserUserPrompt from "@/integrations/ai/prompts/markdown-parser-user.md?raw";
import pdfParserSystemPrompt from "@/integrations/ai/prompts/pdf-parser-system.md?raw";
import pdfParserUserPrompt from "@/integrations/ai/prompts/pdf-parser-user.md?raw";
import { defaultResumeData, type ResumeData, resumeDataSchema } from "@/schema/resume/data";
import { protectedProcedure } from "../context";

const aiProviderSchema = z.enum(["ollama", "openai", "gemini", "anthropic", "vercel-ai-gateway", "zhipu"]);

type AIProvider = z.infer<typeof aiProviderSchema>;

type GetModelInput = {
	provider: AIProvider;
	model: string;
	apiKey: string;
	baseURL: string;
};

function getModel(input: GetModelInput) {
	const { provider, model, apiKey } = input;
	const baseURL = input.baseURL || undefined;

	return match(provider)
		.with("openai", () => createOpenAI({ apiKey, baseURL }).languageModel(model))
		.with("ollama", () => createOllama({ apiKey, baseURL }).languageModel(model))
		.with("anthropic", () => createAnthropic({ apiKey, baseURL }).languageModel(model))
		.with("vercel-ai-gateway", () => createGateway({ apiKey, baseURL }).languageModel(model))
		.with("gemini", () => createGoogleGenerativeAI({ apiKey, baseURL }).languageModel(model))
		.with("zhipu", () => createZhipu({ apiKey, baseURL: baseURL || undefined })(model))
		.exhaustive();
}

const aiCredentialsSchema = z.object({
	provider: aiProviderSchema,
	model: z.string(),
	apiKey: z.string(),
	baseURL: z.string(),
});

const fileInputSchema = z.object({
	name: z.string(),
	data: z.string(), // base64 encoded
});

// Helper function to parse AI response JSON
function parseAIResponse(text: string): Record<string, unknown> {
	const jsonText = text.trim();
	// Remove markdown code blocks if present
	const cleanJson = jsonText.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "");
	return JSON.parse(cleanJson) as Record<string, unknown>;
}

type DeepObject = Record<string, unknown>;

// Deep merge function - recursively merge source into target, preserving target values when source is undefined
function deepMerge(target: DeepObject, source: DeepObject): DeepObject {
	const result: DeepObject = {};

	// First copy all keys from target
	for (const key of Object.keys(target)) {
		result[key] = target[key];
	}

	// Then merge source into result
	for (const key of Object.keys(source)) {
		const sourceValue = source[key];
		const targetValue = result[key];

		if (sourceValue === undefined || sourceValue === null) {
			// Keep target value
			continue;
		}

		if (Array.isArray(sourceValue)) {
			// For arrays with items, merge each item with default item structure if available
			if (sourceValue.length > 0) {
				result[key] = sourceValue;
			}
			// Keep target (empty array) if source is empty
		} else if (typeof sourceValue === "object" && sourceValue !== null) {
			if (typeof targetValue === "object" && targetValue !== null && !Array.isArray(targetValue)) {
				// Recursively merge nested objects
				result[key] = deepMerge(targetValue as DeepObject, sourceValue as DeepObject);
			} else {
				result[key] = sourceValue;
			}
		} else {
			// For primitives, use source value
			result[key] = sourceValue;
		}
	}

	return result;
}

// Ensure all section items have required fields
function ensureSectionItems(sections: DeepObject): DeepObject {
	const defaultSection = {
		title: "",
		columns: 1,
		hidden: false,
		items: [],
	};

	const sectionKeys = [
		"profiles",
		"experience",
		"education",
		"projects",
		"skills",
		"languages",
		"interests",
		"awards",
		"certifications",
		"publications",
		"volunteer",
		"references",
	];

	const result: DeepObject = {};

	for (const key of sectionKeys) {
		const sectionData = sections[key];
		if (sectionData && typeof sectionData === "object" && !Array.isArray(sectionData)) {
			result[key] = {
				...defaultSection,
				...(sectionData as DeepObject),
			};
		} else {
			result[key] = { ...defaultSection };
		}
	}

	return result;
}

// Merge AI response with default resume data
function mergeWithDefaults(parsed: DeepObject): ResumeData {
	// Log the parsed data for debugging
	console.log("AI Response (parsed):", JSON.stringify(parsed, null, 2).substring(0, 2000));

	// Ensure basics has all required fields
	const defaultBasics = {
		name: "",
		headline: "",
		email: "",
		phone: "",
		location: "",
		website: { url: "", label: "" },
		customFields: [],
	};

	const parsedBasics = (parsed.basics as DeepObject) || {};
	const basics = { ...defaultBasics, ...parsedBasics };

	// Handle website field specially
	if (basics.website && typeof basics.website === "object") {
		basics.website = {
			url: (basics.website as DeepObject).url || "",
			label: (basics.website as DeepObject).label || "",
		};
	} else {
		basics.website = { url: "", label: "" };
	}

	// Ensure summary has all required fields
	const defaultSummary = {
		title: "",
		columns: 1,
		hidden: false,
		content: "",
	};
	const parsedSummary = (parsed.summary as DeepObject) || {};
	const summary = { ...defaultSummary, ...parsedSummary };

	// Ensure sections has all required fields
	const parsedSections = (parsed.sections as DeepObject) || {};
	const sections = ensureSectionItems(parsedSections);

	const merged: DeepObject = {
		basics,
		summary,
		sections,
		customSections: [],
		picture: defaultResumeData.picture,
		metadata: defaultResumeData.metadata,
	};

	console.log("Merged data:", JSON.stringify(merged, null, 2).substring(0, 2000));

	return resumeDataSchema.parse(merged);
}

export const aiRouter = {
	testConnection: protectedProcedure
		.input(
			z.object({
				provider: aiProviderSchema,
				model: z.string(),
				apiKey: z.string(),
				baseURL: z.string(),
			}),
		)
		.handler(async function* ({ input }) {
			const stream = streamText({
				temperature: 0,
				model: getModel(input),
				messages: [{ role: "user", content: 'Respond with "1"' }],
			});

			yield* stream.textStream;
		}),

	parsePdf: protectedProcedure
		.input(
			z.object({
				...aiCredentialsSchema.shape,
				file: fileInputSchema,
			}),
		)
		.handler(async ({ input }) => {
			try {
				const model = getModel(input);

				const result = await generateText({
					model,
					maxRetries: 0,
					messages: [
						{
							role: "system",
							content: pdfParserSystemPrompt,
						},
						{
							role: "user",
							content: [
								{ type: "text", text: pdfParserUserPrompt },
								{
									type: "file",
									filename: input.file.name,
									mediaType: "application/pdf",
									data: input.file.data,
								},
							],
						},
					],
				});

				const parsed = parseAIResponse(result.text);
				return mergeWithDefaults(parsed);
			} catch (error) {
				if (error instanceof ZodError) {
					const errors = flattenError(error);
					throw new Error(JSON.stringify(errors));
				}

				if (error instanceof SyntaxError) {
					throw new Error("AI 返回的 JSON 格式无效，请重试");
				}

				throw error;
			}
		}),

	parseDocx: protectedProcedure
		.input(
			z.object({
				...aiCredentialsSchema.shape,
				file: fileInputSchema,
				mediaType: z.enum([
					"application/msword",
					"application/vnd.openxmlformats-officedocument.wordprocessingml.document",
				]),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const model = getModel(input);

				const result = await generateText({
					model,
					maxRetries: 0,
					messages: [
						{ role: "system", content: docxParserSystemPrompt },
						{
							role: "user",
							content: [
								{ type: "text", text: docxParserUserPrompt },
								{
									type: "file",
									filename: input.file.name,
									mediaType: input.mediaType,
									data: input.file.data,
								},
							],
						},
					],
				});

				const parsed = parseAIResponse(result.text);
				return mergeWithDefaults(parsed);
			} catch (error) {
				if (error instanceof ZodError) {
					const errors = flattenError(error);
					throw new Error(JSON.stringify(errors));
				}

				if (error instanceof SyntaxError) {
					throw new Error("AI 返回的 JSON 格式无效，请重试");
				}

				throw error;
			}
		}),

	parseMarkdown: protectedProcedure
		.input(
			z.object({
				...aiCredentialsSchema.shape,
				content: z.string(),
			}),
		)
		.handler(async ({ input }) => {
			try {
				const model = getModel(input);

				const result = await generateText({
					model,
					maxRetries: 0,
					messages: [
						{ role: "system", content: markdownParserSystemPrompt },
						{
							role: "user",
							content: `${markdownParserUserPrompt}\n\n---\n\n${input.content}`,
						},
					],
				});

				console.log("AI Raw Response:", result.text.substring(0, 2000));

				const parsed = parseAIResponse(result.text);
				return mergeWithDefaults(parsed);
			} catch (error) {
				console.error("Parse Markdown Error:", error);

				if (error instanceof ZodError) {
					const errors = flattenError(error);
					throw new Error(JSON.stringify(errors));
				}

				if (error instanceof SyntaxError) {
					throw new Error("AI 返回的 JSON 格式无效，请重试");
				}

				throw error;
			}
		}),
};
