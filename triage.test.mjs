import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { createAppServer } from "./server.mjs";

describe("POST /api/triage", () => {
  let server;
  let baseUrl;

  before(async () => {
    server = createAppServer();
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    baseUrl = `http://127.0.0.1:${port}`;
  });

  after(async () => {
    await new Promise((resolve) => server.close(resolve));
  });

  it("возвращает 400 invalid_input при некорректном вводе", async () => {
    const invalidPayloads = [
      "{broken-json",
      JSON.stringify({}),
      JSON.stringify({ text: "" }),
      JSON.stringify({ text: "   " }),
      JSON.stringify({ text: 42 }),
      JSON.stringify(null),
    ];

    for (const body of invalidPayloads) {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { status: "invalid_input" });
    }
  });

  it("возвращает manual_review при таймауте модели (> 300 мс)", async () => {
    const startedAt = Date.now();
    const res = await fetch(`${baseUrl}/api/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Вопрос по доставке [timeout]" }),
    });
    const elapsed = Date.now() - startedAt;

    assert.equal(res.status, 200);
    assert.ok(elapsed < 600, `Ожидался обрыв по таймауту ~300 мс, прошло ${elapsed} мс`);
    assert.deepEqual(await res.json(), {
      status: "manual_review",
      topic: null,
      draft: null,
    });
  });

  it("возвращает manual_review при ошибке модели, битом JSON, неверной теме и пустом черновике", async () => {
    const failureInputs = [
      "Сбой провайдера [error]",
      "Кривой ответ [bad-json]",
      "Недопустимая тема [bad-topic]",
      "Пустой черновик [empty-draft]",
    ];

    for (const text of failureInputs) {
      const res = await fetch(`${baseUrl}/api/triage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text }),
      });

      assert.equal(res.status, 200);
      assert.deepEqual(await res.json(), {
        status: "manual_review",
        topic: null,
        draft: null,
      });
    }
  });

  it("возвращает ready с темой и черновиком при штатной работе", async () => {
    const res = await fetch(`${baseUrl}/api/triage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: "Подскажите стоимость доставки" }),
    });

    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), {
      status: "ready",
      topic: "pricing",
      draft: "Спасибо за обращение. Уточним детали заявки.",
    });
  });
});
