import { expect, test } from "bun:test";
import { posix } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "@babel/parser";

type ModuleGraph = ReadonlyMap<string, string>;
type Violation = {
  readonly file: string;
  readonly dependency: string;
  readonly rule: string;
};

function isNode(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function literal(value: unknown): string | null {
  return isNode(value) &&
    value.type === "StringLiteral" &&
    typeof value.value === "string"
    ? value.value
    : null;
}

function dependencies(source: string): readonly (string | null)[] {
  const found: (string | null)[] = [];
  const ast = parse(source, {
    sourceType: "module",
    plugins: ["typescript", "jsx", "decorators-legacy"],
    createImportExpressions: true,
  });
  const visit = (node: unknown): void => {
    if (Array.isArray(node)) {
      for (const child of node) visit(child);
      return;
    }
    if (!isNode(node)) return;
    switch (node.type) {
      case "ImportDeclaration":
      case "ExportNamedDeclaration":
      case "ExportAllDeclaration": {
        const dependency = literal(node.source);
        if (dependency !== null) found.push(dependency);
        break;
      }
      case "ImportExpression":
        found.push(literal(node.source));
        break;
      case "TSImportType":
        found.push(literal(node.argument));
        break;
      case "TSExternalModuleReference":
        found.push(literal(node.expression));
        break;
      case "CallExpression":
        if (
          isNode(node.callee) &&
          node.callee.type === "Identifier" &&
          node.callee.name === "require" &&
          Array.isArray(node.arguments)
        ) {
          found.push(literal(node.arguments[0]));
        }
        break;
    }
    for (const child of Object.values(node)) visit(child);
  };
  visit(ast);
  return found;
}

function resolveDependency(
  file: string,
  dependency: string,
  graph: ModuleGraph,
): string {
  if (!dependency.startsWith(".")) return dependency;
  const base = posix.normalize(posix.join(posix.dirname(file), dependency));
  const sourceBase = base.replace(/\.(?:js|mjs|cjs)$/, "");
  return (
    [
      base,
      `${sourceBase}.ts`,
      `${sourceBase}.tsx`,
      `${base}/index.ts`,
      `${base}/index.tsx`,
    ].find((candidate) => graph.has(candidate)) ?? base
  );
}

function providerOf(file: string): string | undefined {
  return /^src\/music\/providers\/([^/]+)\//.exec(file)?.[1];
}

function checkBoundaries(graph: ModuleGraph): readonly Violation[] {
  const violations: Violation[] = [];
  const edges = new Map<string, string[]>();
  for (const [file, source] of graph) {
    const imports: string[] = [];
    for (const specifier of dependencies(source)) {
      if (specifier === null) {
        if (file.startsWith("src/music/")) {
          violations.push({
            file,
            dependency: "<dynamic>",
            rule: "dynamic-import",
          });
        }
        continue;
      }
      const dependency = resolveDependency(file, specifier, graph);
      imports.push(dependency);
      const fromProvider = providerOf(file);
      const toProvider = providerOf(dependency);
      const reject = (rule: string) =>
        violations.push({ file, dependency, rule });
      if (
        toProvider &&
        fromProvider !== toProvider &&
        !/^src\/music\/providers\/[^/]+\/(?:(?:server|browser)\/)?index\.ts$/.test(
          dependency,
        )
      ) {
        reject("private-import");
      }
      if (fromProvider && toProvider && fromProvider !== toProvider) {
        reject("cross-provider");
      }
      if (
        toProvider &&
        !fromProvider &&
        file !== "src/domains/providers.ts" &&
        file !== "src/pages/admin/music-registry.ts"
      ) {
        reject("provider-composition");
      }
      if (
        fromProvider &&
        ((!toProvider &&
          dependency.startsWith("src/") &&
          !dependency.startsWith("src/music/contracts/")) ||
          /^(?:@fluojs\/|react(?:-dom)?(?:\/|$))/.test(dependency))
      ) {
        reject("provider-host");
      }
      if (
        file.startsWith("src/music/contracts/") &&
        !dependency.startsWith("src/music/contracts/")
      ) {
        reject("contracts-implementation");
      }
    }
    edges.set(file, imports);
  }

  for (const file of graph.keys()) {
    const isCore =
      /^src\/domains\/(?:queue|search|playback)\/.*\.service\.ts$/.test(file);
    const isBrowser =
      (file.startsWith("src/pages/") && !file.endsWith("/entry-server.ts")) ||
      /^src\/music\/providers\/[^/]+\/(?:browser\/.*|index\.ts)$/.test(file) ||
      file.startsWith("src/music/contracts/");
    if (!isCore && !isBrowser) continue;
    const visited = new Set<string>();
    const walk = (module: string): void => {
      if (visited.has(module)) return;
      visited.add(module);
      for (const dependency of edges.get(module) ?? []) {
        if (isCore && providerOf(dependency)) {
          violations.push({ file, dependency, rule: "core-provider" });
        }
        if (
          isBrowser &&
          (/^(?:node:|bun(?::|$))/.test(dependency) ||
            /^src\/music\/providers\/[^/]+\/server\//.test(dependency))
        ) {
          violations.push({ file, dependency, rule: "browser-server" });
        }
        walk(dependency);
      }
    };
    walk(file);
  }
  return violations;
}

test("모듈 경계: 실제 소스는 공개 배럴과 실행 환경 경계를 지켜요", async () => {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const graph = new Map<string, string>();
  for await (const path of new Bun.Glob("src/**/*.{ts,tsx}").scan({
    cwd: root,
  })) {
    const file = path.replaceAll("\\", "/");
    if (
      /\.test\.tsx?$/.test(file) ||
      file.endsWith(".d.ts") ||
      file.endsWith("/test-support.ts") ||
      file.startsWith("src/music/testing/")
    ) {
      continue;
    }
    graph.set(file, await Bun.file(new URL(file, `file://${root}`)).text());
  }

  expect(graph.size).toBeGreaterThan(0);
  expect(checkBoundaries(graph)).toEqual([]);
});

test("모듈 경계: 타입 import와 재수출도 내부 구현 접근을 막아요", () => {
  const graph = new Map([
    [
      "src/domains/providers.ts",
      'import type { Secret } from "../music/providers/example/server/private"; export type { Secret } from "../music/providers/example/server/private";',
    ],
    [
      "src/music/providers/example/server/private.ts",
      "export type Secret = string;",
    ],
  ]);

  expect(checkBoundaries(graph).map(({ rule }) => rule)).toEqual([
    "private-import",
    "private-import",
  ]);
});

test("모듈 경계: 같은 공급자 내부 접근과 조립 지점의 공개 접근을 허용해요", () => {
  const graph = new Map([
    [
      "src/domains/providers.ts",
      'import { create } from "../music/providers/example/server";',
    ],
    [
      "src/music/providers/example/server/index.ts",
      'export { create } from "./private";',
    ],
    [
      "src/music/providers/example/server/private.ts",
      "export const create = () => 1;",
    ],
  ]);

  expect(checkBoundaries(graph)).toEqual([]);
});

test("모듈 경계: 코어가 간접 경로로 공급자 구현에 의존해도 거절해요", () => {
  const graph = new Map([
    [
      "src/domains/queue/queue.service.ts",
      'import "../shared/provider-helper";',
    ],
    [
      "src/domains/shared/provider-helper.ts",
      'export { create } from "../../music/providers/example/server";',
    ],
    [
      "src/music/providers/example/server/index.ts",
      "export const create = () => 1;",
    ],
  ]);

  expect(checkBoundaries(graph)).toContainEqual({
    file: "src/domains/queue/queue.service.ts",
    dependency: "src/music/providers/example/server/index.ts",
    rule: "core-provider",
  });
});

test("모듈 경계: 브라우저의 동적 import도 서버 구현으로 이어지면 거절해요", () => {
  const graph = new Map([
    [
      "src/music/providers/example/browser/index.ts",
      'export const load = () => import("../server");',
    ],
    ["src/music/providers/example/server/index.ts", 'import "node:fs";'],
  ]);

  expect(checkBoundaries(graph)).toContainEqual({
    file: "src/music/providers/example/browser/index.ts",
    dependency: "src/music/providers/example/server/index.ts",
    rule: "browser-server",
  });
});

test("모듈 경계: 공급자끼리와 앱 서비스로 역방향 의존하지 않아요", () => {
  const graph = new Map([
    [
      "src/music/providers/first/server/index.ts",
      'import "../../second/server"; import "../../../../domains/queue/queue.service"; import "react";',
    ],
    ["src/music/providers/second/server/index.ts", "export {};"],
    ["src/domains/queue/queue.service.ts", "export {};"],
  ]);

  expect(checkBoundaries(graph).map(({ rule }) => rule)).toEqual([
    "cross-provider",
    "provider-host",
    "provider-host",
  ]);
});

test("모듈 경계: 주석과 문자열은 의존성으로 오인하지 않아요", () => {
  const graph = new Map([
    [
      "src/domains/queue/queue.service.ts",
      '// import "../music/providers/example/server";\nconst text = \'import "node:fs"\';',
    ],
  ]);

  expect(checkBoundaries(graph)).toEqual([]);
});

test("모듈 경계: 공개 공급자 배럴도 조립 지점에서만 가져와요", () => {
  const graph = new Map([
    [
      "src/pages/admin/music-panel.tsx",
      'import { create } from "../../music/providers/example/browser";',
    ],
    [
      "src/music/providers/example/browser/index.ts",
      "export const create = () => 1;",
    ],
  ]);

  expect(checkBoundaries(graph)).toContainEqual({
    file: "src/pages/admin/music-panel.tsx",
    dependency: "src/music/providers/example/browser/index.ts",
    rule: "provider-composition",
  });
});

test("모듈 경계: 공급자는 middleware에도 역방향 의존하지 않아요", () => {
  const graph = new Map([
    [
      "src/music/providers/example/server/index.ts",
      'import "../../../../middleware/device-cookie.middleware";',
    ],
    ["src/middleware/device-cookie.middleware.ts", "export {};"],
  ]);

  expect(checkBoundaries(graph)).toContainEqual({
    file: "src/music/providers/example/server/index.ts",
    dependency: "src/middleware/device-cookie.middleware.ts",
    rule: "provider-host",
  });
});

test("모듈 경계: 공통 계약에 프레임워크 타입도 유입되지 않아요", () => {
  const graph = new Map([
    [
      "src/music/contracts/catalog.ts",
      'import type { ReactNode } from "react"; export type Item = ReactNode;',
    ],
  ]);

  expect(checkBoundaries(graph)).toContainEqual({
    file: "src/music/contracts/catalog.ts",
    dependency: "react",
    rule: "contracts-implementation",
  });
});
