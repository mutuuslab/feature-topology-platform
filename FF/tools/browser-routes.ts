// 브라우저는 경로·권한·필수 질의만 쓴다. 서버의 요청 본문 검증기는 routes.ts에 그대로 두고, Vite가 읽는 코드에서만 제외한다.
// 배포 빌드(dropSummary)는 사람이 읽는 요약도 뺀다 — 화면(/admin/iam)은 API 응답의 요약을 쓰고, 개발 서버·시험은 원문 그대로 본다(첫 화면 묶음 예산).
// 원천 표를 AST로 바꾸므로 별도 경로 표나 생성 파일을 동기화할 필요가 없다.
// 운영 빌드(dropSummary)는 설명(summary)도 뺀다 — 화면은 설명을 쓰지 않고(OpenAPI 문서용), 경로가 늘 때마다 첫 화면 묶음이 커졌다(2026-11-06).
// 개발 서버·단위 시험은 설명을 그대로 둔다(시험이 설명 문구를 검사한다).
import ts from 'typescript';

export function browserRouteSource(source: string, opts: { dropSummary?: boolean } = {}): string {
  const dropped = new Set(['body', ...(opts.dropSummary ? ['summary'] : [])]);
  const file = ts.createSourceFile('routes.ts', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let found = false;
  const transformed = ts.transform(file, [(context) => (root) => {
    const visit: ts.Visitor = (node) => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === 'ROUTES') {
        if (!node.initializer || !ts.isArrayLiteralExpression(node.initializer)) throw new Error('브라우저 경로 표: ROUTES 배열을 찾을 수 없습니다.');
        found = true;
        const elements = node.initializer.elements.map((entry) => {
          if (!ts.isObjectLiteralExpression(entry)) throw new Error('브라우저 경로 표: 경로 항목은 객체여야 합니다.');
          return ts.factory.updateObjectLiteralExpression(entry, entry.properties.filter((p) =>
            !(ts.isPropertyAssignment(p) && (ts.isIdentifier(p.name) || ts.isStringLiteral(p.name)) && dropped.has(p.name.text)),
          ));
        });
        return ts.factory.updateVariableDeclaration(node, node.name, node.exclamationToken, node.type, ts.factory.updateArrayLiteralExpression(node.initializer, elements));
      }
      return ts.visitEachChild(node, visit, context);
    };
    return ts.visitNode(root, visit) as ts.SourceFile;
  }]);
  try {
    if (!found) throw new Error('브라우저 경로 표: ROUTES 선언이 없습니다.');
    const output = transformed.transformed[0];
    const used = new Set<string>();
    const collect = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) return;
      if (ts.isIdentifier(node)) used.add(node.text);
      ts.forEachChild(node, collect);
    };
    collect(output);
    const statements = output.statements.flatMap((node): ts.Statement[] => {
      if (!ts.isImportDeclaration(node) || !node.importClause) return [node];
      const clause = node.importClause;
      const name = clause.name && used.has(clause.name.text) ? clause.name : undefined;
      let bindings = clause.namedBindings;
      if (bindings && ts.isNamedImports(bindings)) {
        const elements = bindings.elements.filter((e) => used.has(e.name.text));
        bindings = elements.length ? ts.factory.updateNamedImports(bindings, elements) : undefined;
      } else if (bindings && !used.has(bindings.name.text)) bindings = undefined;
      if (!name && !bindings) return [];
      return [ts.factory.updateImportDeclaration(node, node.modifiers, ts.factory.updateImportClause(clause, clause.isTypeOnly, name, bindings), node.moduleSpecifier, node.attributes)];
    });
    return ts.createPrinter({ newLine: ts.NewLineKind.LineFeed }).printFile(ts.factory.updateSourceFile(output, statements));
  } finally {
    transformed.dispose();
  }
}
