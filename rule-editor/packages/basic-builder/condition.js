import { createToken, CstParser, EOF, Lexer } from "../../node_modules/chevrotain/lib/chevrotain.mjs";

const Space = createToken({ name: "ConditionSpace", pattern: /\s+/, group: Lexer.SKIPPED });
const Quoted = createToken({ name: "ConditionQuoted", pattern: /"(?:[^"]|"")*"/, line_breaks: true });
const And = createToken({ name: "ConditionAnd", pattern: /&&/ });
const Or = createToken({ name: "ConditionOr", pattern: /\|\|/ });
const Left = createToken({ name: "ConditionLeft", pattern: /\(/ });
const Right = createToken({ name: "ConditionRight", pattern: /\)/ });
const BraceLeft = createToken({ name: "ConditionBraceLeft", pattern: /\{/ });
const BraceRight = createToken({ name: "ConditionBraceRight", pattern: /\}/ });
const BracketLeft = createToken({ name: "ConditionBracketLeft", pattern: /\[/ });
const BracketRight = createToken({ name: "ConditionBracketRight", pattern: /\]/ });
const Comma = createToken({ name: "ConditionComma", pattern: /,/ });
const ExpressionOperator = createToken({ name: "ExpressionOperator", pattern: /!=|>=|<=|[=<>+*/_!\-]/ });
const Symbol = createToken({ name: "ConditionSymbol", pattern: /[&|]/ });
const Text = createToken({ name: "ConditionText", pattern: /[^"\s(){}\[\],&|=<>+*/_!\-]+/ });
const tokens = [Space, Quoted, And, Or, Left, Right, BraceLeft, BraceRight, BracketLeft, BracketRight, Comma, ExpressionOperator, Symbol, Text];
const lexer = new Lexer(tokens);

class ConditionParser extends CstParser {
  constructor() {
    super(tokens);
    this.RULE("document", () => { this.SUBRULE(this.sequence); this.CONSUME(EOF); });
    this.RULE("sequence", () => { this.MANY(() => this.SUBRULE(this.part)); });
    this.RULE("part", () => {
      this.OR([
        { ALT: () => this.CONSUME(Quoted) }, { ALT: () => this.CONSUME(And) },
        { ALT: () => this.CONSUME(Or) }, { ALT: () => this.CONSUME(Symbol) },
        { ALT: () => this.CONSUME(Comma) }, { ALT: () => this.CONSUME(ExpressionOperator) },
        { ALT: () => this.CONSUME(Text) }, { ALT: () => this.SUBRULE(this.parentheses) },
        { ALT: () => this.SUBRULE(this.braces) }, { ALT: () => this.SUBRULE(this.brackets) }
      ]);
    });
    this.RULE("parentheses", () => { this.CONSUME(Left); this.SUBRULE(this.sequence); this.CONSUME(Right); });
    this.RULE("braces", () => { this.CONSUME(BraceLeft); this.SUBRULE(this.sequence); this.CONSUME(BraceRight); });
    this.RULE("brackets", () => { this.CONSUME(BracketLeft); this.SUBRULE(this.sequence); this.CONSUME(BracketRight); });
    this.performSelfAnalysis();
  }
}

const parser = new ConditionParser();
const BaseVisitor = parser.getBaseCstVisitorConstructor();
class ConditionVisitor extends BaseVisitor {
  constructor() { super(); this.validateVisitor(); }
  document(context) { return this.visit(context.sequence); }
  sequence(context) { return (context.part ?? []).map(part => this.visit(part)); }
  part(context) {
    if (context.parentheses) return this.visit(context.parentheses);
    if (context.braces) return this.visit(context.braces);
    if (context.brackets) return this.visit(context.brackets);
    const token = Object.values(context)[0][0];
    const kind = token.tokenType === And ? "AND" : token.tokenType === Or ? "OR"
      : token.tokenType === ExpressionOperator || token.tokenType === Symbol ? "operator"
        : token.tokenType === Comma ? "comma" : "atom";
    return { kind, value: token.image, start: token.startOffset, end: token.endOffset + 1 };
  }
  parentheses(context) {
    return { kind: "group", parts: this.visit(context.sequence), start: context.ConditionLeft[0].startOffset, end: context.ConditionRight[0].endOffset + 1 };
  }
  braces(context) { return { kind: "atom", start: context.ConditionBraceLeft[0].startOffset, end: context.ConditionBraceRight[0].endOffset + 1 }; }
  brackets(context) { return { kind: "atom", start: context.ConditionBracketLeft[0].startOffset, end: context.ConditionBracketRight[0].endOffset + 1 }; }
}
const visitor = new ConditionVisitor();

export function parseExpressionParts(value) {
  const source = String(value ?? "");
  if (source.length > 20000) throw new RangeError("Condition exceeds formatter limit.");
  const lexed = lexer.tokenize(source);
  if (lexed.errors.length) throw new SyntaxError("Unclosed quote or unsupported condition token.");
  parser.input = lexed.tokens;
  const syntax = parser.document();
  if (parser.errors.length) throw new SyntaxError("Unbalanced condition delimiters.");
  return visitor.visit(syntax);
}

function logicalTree(parts, source) {
  if (!parts.length) throw new SyntaxError("Missing condition operand.");
  if (parts.length === 1 && parts[0].kind === "group") return logicalTree(parts[0].parts, source);
  const operator = parts.some(part => part.kind === "OR") ? "OR" : parts.some(part => part.kind === "AND") ? "AND" : null;
  if (!operator) return { type: "value", value: source.slice(parts[0].start, parts.at(-1).end).trim() };
  const groups = [[]];
  for (const part of parts) {
    if (part.kind === operator) groups.push([]);
    else groups.at(-1).push(part);
  }
  return { type: "operator", operator, operands: groups.map(group => logicalTree(group, source)) };
}

export function parseCondition(value) {
  const source = String(value ?? "");
  if (!source.trim()) return { valid: true, tree: { type: "value", value: "" } };
  try {
    return { valid: true, tree: logicalTree(parseExpressionParts(source), source) };
  } catch (error) {
    return { valid: false, tree: { type: "value", value: source }, error: error.message };
  }
}

export function conditionValueText(value) {
  return value === "1" ? "true" : value === "0" ? "false" : value;
}