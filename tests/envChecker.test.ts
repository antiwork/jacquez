import { jest } from "@jest/globals";
import dotenv from "dotenv";
import {
  loadEnvironmentVariables,
  isPlaceholderValue,
  formatDisplayValue,
  validateEnvironmentConfiguration,
} from "../utils/envChecker";

jest.mock("dotenv", () => ({
  config: jest.fn(),
}));

describe("envChecker", () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe("loadEnvironmentVariables", () => {
    test("calls dotenv.config with correct path", () => {
      loadEnvironmentVariables();

      expect(dotenv.config).toHaveBeenCalledTimes(1);
      expect(dotenv.config).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining(".env"),
        })
      );
    });
  });

  describe("isPlaceholderValue", () => {
    test("returns true for known placeholder values", () => {
      expect(isPlaceholderValue("your_app_id_here")).toBe(true);
      expect(isPlaceholderValue("your_webhook_secret_here")).toBe(true);
      expect(isPlaceholderValue("your_anthropic_api_key_here")).toBe(true);
      expect(isPlaceholderValue("your_GH_CLIENT_ID_here")).toBe(true);
      expect(isPlaceholderValue("your_GH_CLIENT_SECRET_here")).toBe(true);
      expect(isPlaceholderValue("...your private key content here...")).toBe(
        true
      );
    });

    test("returns true for strings containing placeholder values", () => {
      expect(isPlaceholderValue("prefix_your_app_id_here_suffix")).toBe(true);
    });

    test("returns false for actual values", () => {
      expect(isPlaceholderValue("123456")).toBe(false);
      expect(isPlaceholderValue("actual_secret_value")).toBe(false);
      expect(isPlaceholderValue("sk-1234567890abcdef")).toBe(false);
    });
  });

  describe("formatDisplayValue", () => {
    test("masks secret keys showing only first 4 characters", () => {
      expect(formatDisplayValue("API_KEY", "sk-1234567890abcdef")).toBe(
        "sk-1..."
      );
      expect(formatDisplayValue("CLIENT_SECRET", "abcdef1234567890")).toBe(
        "abcd..."
      );
    });

    test("identifies RSA private key correctly", () => {
      expect(
        formatDisplayValue(
          "GH_PRIVATE_KEY",
          "-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----"
        )
      ).toBe("RSA Private Key");
    });

    test("returns full value for non-secret variables", () => {
      expect(formatDisplayValue("APP_ID", "123456")).toBe("123456");
      expect(formatDisplayValue("ENABLE_LOGGING", "true")).toBe("true");
    });
  });

  describe("validateEnvironmentConfiguration", () => {
    const originalEnv = process.env;

    beforeEach(() => {
      process.env = { NODE_ENV: "test" };
    });

    afterAll(() => {
      process.env = originalEnv;
    });

    test("correctly identifies configured variables", () => {
      Object.assign(process.env, {
        GH_APP_ID: "123456",
        GH_WEBHOOK_SECRET: "secret123",
        GH_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\ndata\n-----END RSA PRIVATE KEY-----",
        ANTHROPIC_API_KEY: "sk-ant-api123456",
        GH_CLIENT_ID: "client123",
        GH_CLIENT_SECRET: "clientsecret123",
        AI_MODEL: "claude-3-5-sonnet-20241022",
        ENABLE_CACHING: "true",
        ENABLE_DETAILED_LOGGING: "false",
      });

      const stats = validateEnvironmentConfiguration();

      expect(stats.totalVars).toBeGreaterThan(0);
      expect(stats.configuredVars).toBe(9);
      expect(stats.criticalMissing).toHaveLength(0);
    });

    test("correctly identifies missing critical variables", () => {
      Object.assign(process.env, {
        GH_APP_ID: "123456",
        GH_WEBHOOK_SECRET: "secret123",
        GH_CLIENT_ID: "client123",
        AI_MODEL: "claude-3",
        ENABLE_CACHING: "true",
      });

      const stats = validateEnvironmentConfiguration();

      expect(stats.criticalMissing).toContain("GH_PRIVATE_KEY");
      expect(stats.criticalMissing).toContain("ANTHROPIC_API_KEY");
      expect(stats.criticalMissing).toContain("GH_CLIENT_SECRET");
      expect(stats.criticalMissing).toHaveLength(3);
    });

    test("identifies placeholder values as not configured", () => {
      Object.assign(process.env, {
        GH_APP_ID: "your_app_id_here",
        GH_WEBHOOK_SECRET: "secret123",
        GH_PRIVATE_KEY:
          "-----BEGIN RSA PRIVATE KEY-----\n...your private key content here...\n-----END RSA PRIVATE KEY-----",
        ANTHROPIC_API_KEY: "sk-ant-api123456",
        GH_CLIENT_ID: "client123",
        GH_CLIENT_SECRET: "clientsecret123",
      });

      const stats = validateEnvironmentConfiguration();

      expect(stats.criticalMissing).toContain("GH_APP_ID");
      expect(stats.criticalMissing).toContain("GH_PRIVATE_KEY");
    });
  });
});
