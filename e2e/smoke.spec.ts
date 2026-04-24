import { test, expect } from "@playwright/test";

// Smoke: kritik public sayfalar ayakta + middleware korumalı sayfalar login'e
// yönlendiriyor mu? Gerçek giriş akışı reCAPTCHA nedeniyle E2E'de zor —
// ayrı bir "auth-bypass" seed ile genişletilecek.

test("login sayfası yüklenir ve KVKK linki çalışır", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("heading", { name: /Hesabınıza giriş yapın/i })).toBeVisible();
  await expect(page.getByRole("link", { name: /KVKK/i })).toBeVisible();
  await page.getByRole("link", { name: /KVKK/i }).click();
  await expect(page).toHaveURL(/\/kvkk$/);
  await expect(page.getByRole("heading", { name: /KVKK Aydınlatma/i })).toBeVisible();
});

test("korumalı sayfa girişsiz login'e yönlenir", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login/);
});

test("şifremi unuttum sayfası açılır", async ({ page }) => {
  await page.goto("/login");
  await page.getByRole("link", { name: /Şifremi unuttum/i }).click();
  await expect(page).toHaveURL(/\/forgot/);
  await expect(page.getByRole("heading", { name: /Şifremi Unuttum/i })).toBeVisible();
});

test("geçersiz reset token 404 verir", async ({ page }) => {
  const res = await page.goto("/reset/invalid-token-xyz");
  expect(res?.status()).toBe(404);
});

test("güvenlik header'ları prod-grade", async ({ request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["x-frame-options"]).toBe("SAMEORIGIN");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'self'");
  expect(h["referrer-policy"]).toBeTruthy();
});
