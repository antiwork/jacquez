import dotenv from "dotenv";
import { dirname, join, resolve } from "path";

export function getProjectRoot(): string {
    if (typeof __dirname !== "undefined") {
      return resolve(dirname(__dirname));
    }
  return process.cwd();
}

export interface EnvironmentStats {
  totalVars: number;
  configuredVars: number;
  criticalMissing: string[];
}

const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
} as const;

const CRITICAL_VARIABLES = [
  "GH_APP_ID",
  "GH_WEBHOOK_SECRET",
  "GH_PRIVATE_KEY",
  "ANTHROPIC_API_KEY",
  "GH_CLIENT_ID",
  "GH_CLIENT_SECRET",
] as const;

const VARIABLE_CATEGORIES = {
  "GitHub App Configuration": [
    "GH_APP_ID",
    "GH_WEBHOOK_SECRET",
    "GH_PRIVATE_KEY",
  ],
  "AI Configuration": ["AI_MODEL", "MAX_TOKENS", "ANTHROPIC_API_KEY"],
  "GitHub OAuth Configuration": ["GH_CLIENT_ID", "GH_CLIENT_SECRET"],
  "Caching Configuration": ["ENABLE_CACHING", "CACHE_TIMEOUT"],
  "Logging Configuration": ["ENABLE_DETAILED_LOGGING", "MIN_COMMENT_LENGTH"],
} as const;

const PLACEHOLDER_VALUES = [
  "your_app_id_here",
  "your_webhook_secret_here",
  "your_anthropic_api_key_here",
  "your_GH_CLIENT_ID_here",
  "your_GH_CLIENT_SECRET_here",
  "...your private key content here...",
] as const;

export function loadEnvironmentVariables(): void {
  const projectRoot = getProjectRoot();
  dotenv.config({ path: join(projectRoot, ".env") });
}

export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER_VALUES.some(
    (placeholder) => value === placeholder || value.includes(placeholder)
  );
}

export function formatDisplayValue(
  variableName: string,
  value: string
): string {
  const isSecret =
    variableName.includes("KEY") || variableName.includes("SECRET");

  if (isSecret) {
    return variableName === "GH_PRIVATE_KEY" &&
      value.includes("BEGIN RSA PRIVATE KEY")
      ? "RSA Private Key"
      : `${value.substring(0, 4)}...`;
  }

  return value;
}

function displayHeader(): void {
  console.log(
    `\n${COLORS.bold}${COLORS.cyan}Environment Configuration Status${COLORS.reset}`
  );
  console.log(`${COLORS.gray}${"─".repeat(60)}${COLORS.reset}\n`);
}

function displayFooter(): void {
  console.log(`${COLORS.gray}${"─".repeat(60)}${COLORS.reset}\n`);
  console.log(`${COLORS.cyan}Starting development server...${COLORS.reset}\n`);
}

function processEnvironmentVariable(
  variableName: string,
  stats: EnvironmentStats
): void {
  stats.totalVars++;

  const value = process.env[variableName];
  const isCritical = CRITICAL_VARIABLES.includes(variableName as any);
  const isConfigured = value && !isPlaceholderValue(value);

  if (isConfigured) {
    stats.configuredVars++;
    const displayValue = formatDisplayValue(variableName, value);
    console.log(
      `  ${COLORS.green}✓${COLORS.reset} ${COLORS.dim}${variableName}${COLORS.reset} ${COLORS.gray}${displayValue}${COLORS.reset}`
    );
    return;
  }

  if (isCritical) {
    stats.criticalMissing.push(variableName);
    console.log(
      `  ${COLORS.red}✗${COLORS.reset} ${COLORS.dim}${variableName}${COLORS.reset} ${COLORS.red}MISSING${COLORS.reset}`
    );
  } else {
    console.log(
      `  ${COLORS.yellow}!${COLORS.reset} ${COLORS.dim}${variableName}${COLORS.reset} ${COLORS.yellow}MISSING${COLORS.reset}`
    );
  }
}

function displaySummary(stats: EnvironmentStats): void {
  console.log(`${COLORS.gray}${"─".repeat(60)}${COLORS.reset}`);

  const configurationPercentage = Math.round(
    (stats.configuredVars / stats.totalVars) * 100
  );
  console.log(
    `${COLORS.bold}Summary:${COLORS.reset} ${stats.configuredVars}/${stats.totalVars} variables configured (${configurationPercentage}%)`
  );

  const hasAllCriticalVariables = stats.criticalMissing.length === 0;

  if (hasAllCriticalVariables) {
    console.log(
      `${COLORS.green}${COLORS.bold}Status: Ready${COLORS.reset} - All critical variables configured`
    );
  } else {
    console.log(
      `${COLORS.red}${COLORS.bold}Status: Incomplete${COLORS.reset} - ${stats.criticalMissing.length} critical variable(s) missing`
    );
    console.log(
      `${COLORS.red}Missing:${COLORS.reset} ${stats.criticalMissing.join(", ")}`
    );
  }
}

export function validateEnvironmentConfiguration(): EnvironmentStats {
  loadEnvironmentVariables();

  const stats: EnvironmentStats = {
    totalVars: 0,
    configuredVars: 0,
    criticalMissing: [],
  };

  displayHeader();

  Object.entries(VARIABLE_CATEGORIES).forEach(([categoryName, variables]) => {
    console.log(`${COLORS.bold}${COLORS.white}${categoryName}${COLORS.reset}`);

    variables.forEach((variableName) => {
      processEnvironmentVariable(variableName, stats);
    });

    console.log("");
  });

  displaySummary(stats);
  displayFooter();

  return stats;
}

validateEnvironmentConfiguration();
