import { getModels } from "../src/models.js";
import type { Model } from "../src/types.js";

const ZAI_TEST_MODEL_PREFERENCE = ["glm-5.2", "glm-5-turbo", "glm-4.7"];

// Returns undefined rather than throwing when the catalog lists no eligible model; see
// the note on getKimiCodingTestModel for why a throw here fails the file rather than
// skipping the suite. Callers must resolve outside the describe and add !model to skipIf.
export function getZaiTestModel(
	options: { toolStream?: boolean; smallestContextWindow?: boolean } = {},
): Model<"openai-completions"> | undefined {
	const models = getModels("zai");
	const eligible = options.toolStream ? models.filter((model) => model.compat?.zaiToolStream) : models;
	if (eligible.length === 0) {
		return undefined;
	}
	if (options.smallestContextWindow) {
		return eligible.reduce((smallest, candidate) =>
			candidate.contextWindow < smallest.contextWindow ? candidate : smallest,
		);
	}
	for (const id of ZAI_TEST_MODEL_PREFERENCE) {
		const model = eligible.find((candidate) => candidate.id === id);
		if (model) return model;
	}
	return eligible[0];
}
