import { expect, it, vi } from "vitest";
import {
	getApiProvider,
	registerApiProvider,
	setModelAdmissionGuard,
	unregisterApiProviders,
} from "../src/api-registry.js";
import { stream, streamSimple } from "../src/stream.js";
import { AssistantMessageEventStream } from "../src/utils/event-stream.js";
import { getFixtureModel } from "./fixture-models.js";

it.each([stream, streamSimple])("agent-ops #377 guards existing, late and replacement providers via %s", (dispatch) => {
	const model = { ...getFixtureModel("cerebras", "gpt-oss-120b"), api: "admission-fixture", compat: undefined };
	const result = new AssistantMessageEventStream();
	const delegate = vi.fn(() => result);
	const provider = { api: model.api, stream: delegate, streamSimple: delegate };
	const context = { messages: [] };
	const options = { temperature: 0.25, apiKey: "synthetic-only" };
	let refused = false;
	registerApiProvider(provider, "admission-original");
	const previous = setModelAdmissionGuard(() => {
		if (refused) throw new Error("admission refused");
	});
	try {
		expect(dispatch(model, context, options)).toBe(result);
		expect(delegate).toHaveBeenCalledExactlyOnceWith(model, context, options);
		refused = true;
		for (const api of [model.api, "late-admission-fixture"]) {
			registerApiProvider({ ...provider, api }, "admission-replacement");
			expect(() => dispatch({ ...model, api }, context, options)).toThrow("admission refused");
		}
		unregisterApiProviders("admission-original");
		expect(getApiProvider(model.api)).toBeDefined();
		expect(delegate).toHaveBeenCalledTimes(1);
		setModelAdmissionGuard(() => Promise.resolve());
		expect(() => dispatch(model, context, options)).toThrow("synchronous");
		expect(delegate).toHaveBeenCalledTimes(1);
	} finally {
		setModelAdmissionGuard(previous);
		unregisterApiProviders("admission-original");
		unregisterApiProviders("admission-replacement");
	}
	expect(getApiProvider(model.api)).toBeUndefined();
});
