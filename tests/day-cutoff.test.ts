import { test } from "node:test";
import assert from "node:assert/strict";
import { nextCutoff } from "../src/lib/day-cutoff";

// Colombo is UTC+05:30, so 02:00 there is 20:30 UTC the day before.
const at = (iso: string) => new Date(iso);

test("evening sign-in ends at 02:00 the next morning", () => {
  assert.equal(nextCutoff("02:00", at("2026-11-20T14:00:00Z")).toISOString(), "2026-11-20T20:30:00.000Z"); // 19:30 local
});

test("morning sign-in ends at 02:00 the following night", () => {
  assert.equal(nextCutoff("02:00", at("2026-11-20T03:00:00Z")).toISOString(), "2026-11-20T20:30:00.000Z"); // 08:30 local
});

test("sign-in just after the cutoff waits a full day", () => {
  assert.equal(nextCutoff("02:00", at("2026-11-20T20:31:00Z")).toISOString(), "2026-11-21T20:30:00.000Z"); // 02:01 local
});

test("sign-in exactly at the cutoff moves to the next one", () => {
  assert.equal(nextCutoff("02:00", at("2026-11-20T20:30:00Z")).toISOString(), "2026-11-21T20:30:00.000Z");
});

test("a cutoff before midnight local time", () => {
  assert.equal(nextCutoff("23:30", at("2026-11-20T12:00:00Z")).toISOString(), "2026-11-20T18:00:00.000Z"); // 17:30 → 23:30 local
});

test("crosses month and year ends", () => {
  assert.equal(nextCutoff("02:00", at("2026-12-31T15:00:00Z")).toISOString(), "2026-12-31T20:30:00.000Z"); // 20:30 local, 31 Dec
});
