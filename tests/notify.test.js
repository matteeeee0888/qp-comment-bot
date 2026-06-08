import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildRunSummary,
  buildRunHeader,
  postCaption,
  sendRunPosts,
  sendMessage,
  sendPhoto,
} from "../lib/notify.js";

test("buildRunSummary lists each scheduled post with page + time + first line", () => {
  const txt = buildRunSummary({
    scheduled: [
      { page_name: "Janet Harper", scheduled_date: "2026-06-02", scheduled_time: "09:17", message: "Cats sleep a lot.\nLine two." },
      { page_name: "Lori Clay", scheduled_date: "2026-06-02", scheduled_time: "14:23", message: "Dogs love walks." },
    ],
    posted: [], errors: [],
  });
  assert.match(txt, /Janet Harper/);
  assert.match(txt, /09:17/);
  assert.match(txt, /Cats sleep a lot\./);
  assert.doesNotMatch(txt, /Line two/); // only the first line
  assert.match(txt, /2 scheduled/);
});

test("buildRunSummary lists immediately-posted items too", () => {
  const txt = buildRunSummary({
    scheduled: [],
    posted: [{ page_name: "Susan Miller", message: "Adopt, don't shop.\nmore" }],
    errors: [],
  });
  assert.match(txt, /1 posted/);
  assert.match(txt, /Susan Miller/);
  assert.match(txt, /Adopt, don't shop\./);
  assert.doesNotMatch(txt, /more/);
});

test("buildRunSummary surfaces errors", () => {
  const txt = buildRunSummary({ scheduled: [], posted: [], errors: [{ id: "x", error: "boom" }] });
  assert.match(txt, /1 error/);
  assert.match(txt, /boom/);
});

test("buildRunHeader is just counts + errors, no per-post lines", () => {
  const txt = buildRunHeader({
    scheduled: [{ page_name: "Janet Harper", message: "Cats sleep a lot." }],
    posted: [],
    errors: [{ id: "x", error: "boom" }],
  });
  assert.match(txt, /1 scheduled/);
  assert.match(txt, /boom/);
  assert.doesNotMatch(txt, /Cats sleep a lot/); // full text is sent separately, not in the header
});

test("postCaption combines a headline with the full message", () => {
  const cap = postCaption({
    page_name: "Susan Miller",
    scheduled_date: "2026-06-01",
    scheduled_time: "14:23",
    message: "Line one.\nLine two.",
  });
  assert.match(cap, /Susan Miller — 2026-06-01 14:23/);
  assert.match(cap, /Line one\.\nLine two\./); // full text preserved, not just first line
});

test("sendRunPosts sends a header then one photo per post with the full caption", async () => {
  const calls = [];
  const send = {
    sendMessage: async (a) => (calls.push(["msg", a.text]), { ok: true }),
    sendPhoto: async (a) => (calls.push(["photo", a.imagePath, a.caption]), { ok: true }),
  };
  await sendRunPosts({
    token: "T",
    chatId: "C",
    send,
    run: {
      scheduled: [
        { page_name: "Janet Harper", scheduled_date: "2026-06-01", scheduled_time: "09:17", message: "Hi cats", image_path: "/tmp/a.png" },
      ],
      posted: [],
      errors: [],
    },
  });
  assert.equal(calls[0][0], "msg"); // header first
  assert.match(calls[0][1], /1 scheduled/);
  assert.equal(calls[1][0], "photo");
  assert.equal(calls[1][1], "/tmp/a.png");
  assert.match(calls[1][2], /Hi cats/);
});

test("sendRunPosts splits an over-long caption into photo headline + follow-up text", async () => {
  const calls = [];
  const send = {
    sendMessage: async (a) => (calls.push(["msg", a.text]), { ok: true }),
    sendPhoto: async (a) => (calls.push(["photo", a.caption]), { ok: true }),
  };
  const long = "x".repeat(2000);
  await sendRunPosts({
    token: "T", chatId: "C", send,
    run: { scheduled: [{ page_name: "Lori Clay", scheduled_date: "2026-06-01", scheduled_time: "10:00", message: long, image_path: "/tmp/b.png" }], posted: [], errors: [] },
  });
  // header, photo (headline-only caption), then the full message as its own text
  assert.equal(calls[1][0], "photo");
  assert.doesNotMatch(calls[1][1], /xxxx/); // caption is the short headline, not the 2000-char body
  assert.equal(calls[2][0], "msg");
  assert.equal(calls[2][1], long);
});

test("sendRunPosts falls back to a text message when a post has no image", async () => {
  const calls = [];
  const send = {
    sendMessage: async (a) => (calls.push(["msg", a.text]), { ok: true }),
    sendPhoto: async () => (calls.push(["photo"]), { ok: true }),
  };
  await sendRunPosts({
    token: "T", chatId: "C", send,
    run: { scheduled: [{ page_name: "Diane Foster", message: "No image here", image_path: "" }], posted: [], errors: [] },
  });
  assert.ok(!calls.some((c) => c[0] === "photo"));
  assert.match(calls[1][1], /No image here/);
});

test("sendPhoto passes an http image URL straight to Telegram as JSON", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { json: async () => ({ ok: true }) }; };
  await sendPhoto({ token: "TOK", chatId: "9", imagePath: "https://ex.com/p.jpg", caption: "cap", fetchImpl: fakeFetch });
  assert.match(calls[0].url, /\/botTOK\/sendPhoto/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.photo, "https://ex.com/p.jpg");
  assert.equal(body.caption, "cap");
  assert.equal(body.chat_id, "9");
});

test("sendMessage posts to the Telegram sendMessage endpoint with chat_id + text", async () => {
  const calls = [];
  const fakeFetch = async (url, opts) => { calls.push({ url, opts }); return { json: async () => ({ ok: true }) }; };
  await sendMessage({ token: "TOK", chatId: "123", text: "hi", fetchImpl: fakeFetch });
  assert.match(calls[0].url, /api\.telegram\.org\/botTOK\/sendMessage/);
  const body = JSON.parse(calls[0].opts.body);
  assert.equal(body.chat_id, "123");
  assert.equal(body.text, "hi");
});
