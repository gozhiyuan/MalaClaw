import { test, expect } from "@playwright/test";

test("dashboard overview loads with navigation tabs", async ({ page }) => {
  await page.goto("/");
  await expect(page.locator("nav")).toContainText("openclaw-store");
  await expect(page.locator("nav")).toContainText("Overview");
  await expect(page.locator("nav")).toContainText("Projects");
  await expect(page.locator("nav")).toContainText("Starters");
  await expect(page.locator("nav")).toContainText("Config");
});

test("navigate to Starters tab", async ({ page }) => {
  await page.goto("/");
  await page.click("text=Starters");
  await expect(page).toHaveURL(/\/starters/);
});

test("navigate to Config tab and see manifest", async ({ page }) => {
  await page.goto("/config");
  // Config page should load without error
  await expect(page.locator("main")).toBeVisible();
});

test("navigate to Projects tab", async ({ page }) => {
  await page.goto("/projects");
  await expect(page.locator("main")).toBeVisible();
});

test("API ping returns ok", async ({ request }) => {
  const res = await request.get("/api/ping");
  expect(res.ok()).toBe(true);
  expect(await res.json()).toEqual({ status: "ok" });
});

test("API skills returns array", async ({ request }) => {
  const res = await request.get("/api/skills");
  expect(res.ok()).toBe(true);
  const body = await res.json();
  expect(Array.isArray(body)).toBe(true);
});
