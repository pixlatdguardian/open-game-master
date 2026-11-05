// Character portraits as reference images (src/lib/image-references.ts,
// src/lib/comfyui.ts, src/lib/image-models/workflow.ts).
//
// generate_image names the characters a picture shows. Their portraits go
// to a ComfyUI model that can look at them: Qwen Image 2.1 reads them in its
// text encoder, FLUX.2 klein 4B through ReferenceLatent. Every other model
// paints as before and the table is told the portraits were not used. A
// ComfyUI that will not take a portrait gets no graph at all.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { register } from "node:module";
import { removeTempDir } from "./lib/remove-temp-dir.mjs";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "odm-image-refs-"));
process.env.SQLITE_DB_PATH = path.join(dir, "test.sqlite");
process.env.DB_ENCRYPTION_KEY = randomBytes(32).toString("hex");

register("./lib/register-alias.mjs", import.meta.url);

const { generateComfyImage } = await import("../src/lib/comfyui.ts");
const { comfyModel } = await import("../src/lib/image-models/catalog.ts");
const { buildModelWorkflow, honoursNegative, referenceLead, takesReferences } = await import("../src/lib/image-models/workflow.ts");
const { saveGlobalConfig } = await import("../src/lib/db/app-settings.ts");
const { imageVariantsSettled } = await import("../src/lib/image-variants.ts");
const { createUser } = await import("../src/lib/db/users.ts");
const { createCampaign } = await import("../src/lib/db/campaigns.ts");
const { createSheet } = await import("../src/lib/db/sheets.ts");
const { createSheetSchema } = await import("../src/lib/schemas/sheet.ts");
const { loadImageReferences, resolveImageCharacterIds } = await import("../src/lib/image-references.ts");

// Uploads and generated files land under the working directory.
const repoCwd = process.cwd();
process.chdir(dir);

const COMFY = "http://comfy.test";
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==",
  "base64",
);
const json = (value) => Response.json(value);
const list = (node, input, names) => json({ [node]: { input: { required: { [input]: [names] } } } });

// A ComfyUI with the Qwen Image 2.1 Turbo, klein 4B and Z-Image files.
function fakeComfy(overrides = {}) {
  const routes = {
    "/system_stats": () => json({ system: {} }),
    "/object_info/CheckpointLoaderSimple": () => list("CheckpointLoaderSimple", "ckpt_name", ["model.safetensors"]),
    "/object_info/UNETLoader": () =>
      list("UNETLoader", "unet_name", [
        "qwen_image_2.1_turbo_int8_convrot.safetensors",
        "flux-2-klein-4b.safetensors",
        "z_image_turbo_bf16.safetensors",
      ]),
    "/object_info/CLIPLoader": () =>
      list("CLIPLoader", "clip_name", ["qwen3vl_8b_w4a8.safetensors", "qwen_3_4b.safetensors"]),
    "/object_info/VAELoader": () =>
      list("VAELoader", "vae_name", ["qwen_image_2.1_vae_bf16.safetensors", "flux2-vae.safetensors", "ae.safetensors"]),
    "/upload/image": async (_url, init) => {
      const file = init.body.get("image");
      return json({ name: file.name, subfolder: "", type: "input" });
    },
    "/prompt": () => json({ prompt_id: "p1" }),
    "/history/p1": () =>
      json({ p1: { status: { completed: true }, outputs: { 9: { images: [{ filename: "out.png", subfolder: "", type: "output" }] } } } }),
    "/view": () => new Response(PNG, { headers: { "content-type": "image/png" } }),
    ...overrides,
  };
  const seen = [];
  const fetchStub = async (input, init) => {
    const url = new URL(String(input));
    seen.push({ url: url.href, path: url.pathname, redirect: init?.redirect, body: init?.body });
    if (url.origin !== COMFY) {
      return new Response("followed a redirect");
    }
    const route = routes[url.pathname];
    return route ? route(url, init) : new Response("not found", { status: 404 });
  };
  return { fetchStub, seen };
}

let passed = 0;
async function test(name, comfy, fn) {
  const realFetch = globalThis.fetch;
  if (comfy) {
    globalThis.fetch = comfy.fetchStub;
  }
  try {
    await fn(comfy);
  } finally {
    globalThis.fetch = realFetch;
  }
  passed += 1;
  console.log(`ok - ${name}`);
}

const nodesOf = (graph, type) => Object.entries(graph).filter(([, node]) => node.class_type === type);
const sentGraph = (seen) => JSON.parse(seen.find((call) => call.path === "/prompt").body).prompt;

const qwen = comfyModel("qwen_image_21_turbo");
const klein = comfyModel("flux2_klein_4b");
const zTurbo = comfyModel("z_turbo");
const QWEN_FILES = {
  unet: "qwen_image_2.1_turbo_int8_convrot.safetensors",
  clip: "qwen3vl_8b_w4a8.safetensors",
  vae: "qwen_image_2.1_vae_bf16.safetensors",
};
const KLEIN_FILES = { unet: "flux-2-klein-4b.safetensors", clip: "qwen_3_4b.safetensors", vae: "flux2-vae.safetensors" };
const Z_FILES = { unet: "z_image_turbo_bf16.safetensors", clip: "qwen_3_4b.safetensors", vae: "ae.safetensors" };
const request = (files, references) => ({ prompt: "at a tavern table", width: 1024, height: 1024, seed: 7, files, references });

// --- The graphs ---

await test("only Qwen Image 2.1 and klein 4B take references", null, () => {
  assert.equal(takesReferences(qwen), true);
  assert.equal(takesReferences(comfyModel("qwen_image_21")), true);
  assert.equal(takesReferences(klein), true);
  assert.equal(takesReferences(zTurbo), false);
  // The base klein shares klein's encoder but was not tried with them.
  assert.equal(takesReferences(comfyModel("flux2_klein_4b_base")), false);
  assert.equal(referenceLead(zTurbo, 2), "");
  assert.equal(referenceLead(qwen, 0), "");
});

await test("Qwen Image 2.1 reads two portraits in its encoder, named as pictures 1 and 2", null, () => {
  const graph = buildModelWorkflow(qwen, request(QWEN_FILES, ["odm-ref-a.png", "odm-ref-b.png"]));
  const [[, encoder]] = nodesOf(graph, "TextEncodeQwenImage21");
  const loads = nodesOf(graph, "LoadImage");
  assert.equal(loads.length, 2);
  assert.deepEqual(encoder.inputs["images.image_1"], [loads[0][0], 0]);
  assert.deepEqual(encoder.inputs["images.image_2"], [loads[1][0], 0]);
  assert.deepEqual(loads.map(([, node]) => node.inputs.image), ["odm-ref-a.png", "odm-ref-b.png"]);
  assert.match(encoder.inputs.prompt, /^Pictures 1 and 2 show two characters\. .*at a tavern table$/);
});

await test("without references the Qwen graph is the one it always was", null, () => {
  const plain = buildModelWorkflow(qwen, request(QWEN_FILES, undefined));
  assert.deepEqual(buildModelWorkflow(qwen, request(QWEN_FILES, [])), plain);
  assert.equal(nodesOf(plain, "LoadImage").length, 0);
  const [[, encoder]] = nodesOf(plain, "TextEncodeQwenImage21");
  assert.equal(Object.keys(encoder.inputs).some((key) => key.startsWith("images.")), false);
  assert.equal(encoder.inputs.prompt.endsWith("at a tavern table"), true);
  assert.equal(encoder.inputs.prompt.includes("Picture"), false);
});

await test("klein 4B scales, encodes and chains a portrait into the guider's positive", null, () => {
  const graph = buildModelWorkflow(klein, request(KLEIN_FILES, ["odm-ref-a.png"]));
  const [[loadId, load]] = nodesOf(graph, "LoadImage");
  const [[scaleId, scale]] = nodesOf(graph, "ImageScaleToTotalPixels");
  const [[encodeId, encode]] = nodesOf(graph, "VAEEncode");
  const [[refId, ref]] = nodesOf(graph, "ReferenceLatent");
  const [[textId, text], [negativeId, negativeText]] = nodesOf(graph, "CLIPTextEncode");
  const [[, guider]] = nodesOf(graph, "CFGGuider");
  const [[vaeId]] = nodesOf(graph, "VAELoader");
  assert.equal(load.inputs.image, "odm-ref-a.png");
  assert.deepEqual(scale.inputs.image, [loadId, 0]);
  assert.equal(scale.inputs.megapixels, 1);
  assert.deepEqual(encode.inputs, { pixels: [scaleId, 0], vae: [vaeId, 0] });
  assert.deepEqual(ref.inputs, { conditioning: [textId, 0], latent: [encodeId, 0] });
  assert.deepEqual(guider.inputs.positive, [refId, 0]);
  assert.match(text.inputs.text, /^The character from the reference image, in a new scene: at a tavern table$/);
  // NAG steers away from the negative, so the portrait stays off it.
  assert.deepEqual(guider.inputs.negative, [negativeId, 0]);
  assert.match(negativeText.inputs.text, /typography/);
});

await test("klein 4B weighs a negative prompt through NAG, so a table's boundary reaches it", null, () => {
  assert.equal(honoursNegative(klein), true);
  const graph = buildModelWorkflow(klein, { ...request(KLEIN_FILES, undefined), negative: "no spiders" });
  const [[nagId, nag]] = nodesOf(graph, "NAGuidance");
  const [[unetId]] = nodesOf(graph, "UNETLoader");
  const [[, guider]] = nodesOf(graph, "CFGGuider");
  assert.deepEqual(nag.inputs, { nag_scale: 5, nag_alpha: 0.5, nag_tau: 1.5, model: [unetId, 0] });
  assert.deepEqual(guider.inputs.model, [nagId, 0]);
  assert.equal(guider.inputs.cfg, 1);
  const negative = graph[guider.inputs.negative[0]];
  assert.equal(negative.class_type, "CLIPTextEncode");
  assert.match(negative.inputs.text, /^text, watermark.*, words, letters, caption, subtitle, typography, logo, no spiders$/);
  assert.equal(nodesOf(graph, "ConditioningZeroOut").length, 0);
  // Models without NAG keep their negatives as they were.
  assert.equal(JSON.stringify(buildModelWorkflow(zTurbo, request(Z_FILES, undefined))).includes("typography"), false);
});

await test("klein 4B chains two portraits one after the other", null, () => {
  const graph = buildModelWorkflow(klein, request(KLEIN_FILES, ["odm-ref-a.png", "odm-ref-b.png"]));
  const refs = nodesOf(graph, "ReferenceLatent");
  assert.equal(refs.length, 2);
  assert.deepEqual(refs[1][1].inputs.conditioning, [refs[0][0], 0]);
  assert.deepEqual(nodesOf(graph, "CFGGuider")[0][1].inputs.positive, [refs[1][0], 0]);
});

await test("a model that cannot look at portraits ignores them", null, () => {
  assert.deepEqual(
    buildModelWorkflow(zTurbo, request(Z_FILES, ["odm-ref-a.png"])),
    buildModelWorkflow(zTurbo, request(Z_FILES, undefined)),
  );
});

// --- Sending them to ComfyUI ---

const portrait = (bytes = PNG) => ({ bytes, mime: "image/png", ext: "png" });
const generate = (references) =>
  generateComfyImage({ url: COMFY, prompt: "at a tavern table", mode: "fast", aspect: "square", seed: 7, references });

saveGlobalConfig({ images: { comfyWorkflowPreset: "qwen_image_21_turbo" } });
await test("Qwen Turbo uploads each portrait once and paints with the names ComfyUI gave", fakeComfy(), async ({ seen }) => {
  const other = Buffer.concat([PNG, Buffer.from([0])]);
  const image = await generate([portrait(), portrait(other)]);
  const uploads = seen.filter((call) => call.path === "/upload/image");
  assert.equal(uploads.length, 2);
  const names = uploads.map((call) => call.body.get("image").name);
  // Named by content, so the same portrait overwrites its own copy.
  for (const name of names) {
    assert.match(name, /^odm-ref-[0-9a-f]{24}\.png$/);
  }
  assert.notEqual(names[0], names[1]);
  assert.equal(uploads[0].body.get("overwrite"), "true");
  const graph = sentGraph(seen);
  assert.deepEqual(nodesOf(graph, "LoadImage").map(([, node]) => node.inputs.image), names);
  assert.ok(seen.every((call) => call.redirect === "manual"), "a ComfyUI request would follow redirects");
  assert.equal(image.warnings, undefined);
});

await test("a portrait in a subfolder is loaded by its subfolder path", fakeComfy({
  "/upload/image": () => json({ name: "odm-ref-x.png", subfolder: "odm", type: "input" }),
}), async ({ seen }) => {
  await generate([portrait()]);
  assert.deepEqual(nodesOf(sentGraph(seen), "LoadImage").map(([, node]) => node.inputs.image), ["odm/odm-ref-x.png"]);
});

for (const [why, route] of [
  ["refuses", () => new Response("no", { status: 500 })],
  ["redirects", () => new Response(null, { status: 302, headers: { location: "http://169.254.169.254/" } })],
  ["answers without a name", () => json({ subfolder: "" })],
]) {
  await test(`a ComfyUI that ${why} on upload gets no graph`, fakeComfy({ "/upload/image": route }), async ({ seen }) => {
    await assert.rejects(generate([portrait()]), /reference portrait|ComfyUI/);
    assert.ok(!seen.some((call) => call.path === "/prompt"), "a graph went to ComfyUI anyway");
    assert.ok(!seen.some((call) => !call.url.startsWith(COMFY)), "a redirect was followed");
  });
}

saveGlobalConfig({ images: { comfyWorkflowPreset: "z_turbo" } });
await test("Z-Image uploads nothing and says the portraits were not used", fakeComfy(), async ({ seen }) => {
  const image = await generate([portrait()]);
  assert.ok(!seen.some((call) => call.path === "/upload/image"));
  assert.equal(nodesOf(sentGraph(seen), "LoadImage").length, 0);
  assert.equal(image.warnings.length, 1);
  assert.match(image.warnings[0], /not used by Z-Image Turbo/);
});
await test("Z-Image without portraits has no warning", fakeComfy(), async () => {
  const image = await generate([]);
  assert.equal(image.warnings, undefined);
});
saveGlobalConfig({ images: { comfyWorkflowPreset: "checkpoint" } });

// --- Which characters, and which portraits ---

const sheetOf = (name, portraitUrl) =>
  createSheetSchema.parse({
    name,
    race: "tiefling",
    class: "rogue",
    abilities: { str: 8, dex: 16, con: 12, int: 12, wis: 10, cha: 14 },
    maxHp: 14,
    ac: 13,
    hitDice: { die: "d8", total: 2, spent: 0 },
    proficiencies: { saves: ["dex"], skills: [], languages: ["common"], tools: [], armor: [], weapons: [] },
    equipment: [],
    gold: 0,
    portrait: portraitUrl ? { url: portraitUrl } : null,
  });

const uploads = path.join(dir, "public", "uploads");
fs.mkdirSync(uploads, { recursive: true });
const PORTRAIT_URL = "/uploads/11111111-1111-4111-8111-111111111111.png";
fs.writeFileSync(path.join(dir, "public", PORTRAIT_URL), PNG);
const NOT_A_PICTURE = "/uploads/22222222-2222-4222-8222-222222222222.png";
fs.writeFileSync(path.join(dir, "public", NOT_A_PICTURE), "this is text, not a picture");
const MISSING = "/uploads/33333333-3333-4333-8333-333333333333.png";

const owner = createUser("refs-owner", "x");
const campaignOf = (title) =>
  createCampaign(owner.id, { title, description: "", theme: "", maxPlayers: 4, startingLevel: 2, difficulty: "normal" });
const campaign = campaignOf("Portraits");
const elsewhere = campaignOf("Another table");
const vex = createSheet(campaign.id, owner.id, 2, sheetOf("Vex", PORTRAIT_URL));
const brannoc = createSheet(campaign.id, owner.id, 2, sheetOf("Brannoc", NOT_A_PICTURE));
const liriel = createSheet(campaign.id, owner.id, 2, sheetOf("Liriel", MISSING));
const plain = createSheet(campaign.id, owner.id, 2, sheetOf("Plain", null));
const stranger = createSheet(elsewhere.id, owner.id, 2, sheetOf("Stranger", PORTRAIT_URL));

await test("characters are resolved by id or name, once each, at most two, this campaign only", null, () => {
  assert.deepEqual(resolveImageCharacterIds(campaign.id, undefined), []);
  assert.deepEqual(resolveImageCharacterIds(campaign.id, [vex.id, "brannoc"]), [vex.id, brannoc.id]);
  assert.deepEqual(resolveImageCharacterIds(campaign.id, ["Vex", vex.id, "nobody", liriel.id, plain.id]), [vex.id, liriel.id]);
  assert.deepEqual(resolveImageCharacterIds(campaign.id, [stranger.id, "Stranger"]), []);
});

await test("only real pictures from this app's uploads are passed on", null, async () => {
  const references = await loadImageReferences(campaign.id, [vex.id, brannoc.id]);
  assert.equal(references.length, 1);
  assert.deepEqual(references[0], { bytes: PNG, mime: "image/png", ext: "png" });
  assert.deepEqual(await loadImageReferences(campaign.id, [liriel.id, plain.id]), []);
  assert.deepEqual(await loadImageReferences(campaign.id, [stranger.id]), []);
  assert.deepEqual(await loadImageReferences(campaign.id, undefined), []);
});

await imageVariantsSettled();
process.chdir(repoCwd);
removeTempDir(dir);
console.log(`test-image-references: ${passed} passed`);
