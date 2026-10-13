const functions = {
    sum: { min: 1, max: 1000, run: a => a.reduce((s, n) => s + n, 0) },
    min: { min: 1, max: 1000, run: a => Math.min(...a) },
    max: { min: 1, max: 1000, run: a => Math.max(...a) },
    round: { min: 1, max: 2, run: ([n, decimals = 2]) => {
            if (!Number.isInteger(decimals) || decimals < 0 || decimals > 6)
                throw new Error('Rounding precision must be 0–6.');
            return Math.round((n + Number.EPSILON) * 10 ** decimals) / 10 ** decimals;
        } },
    abs: { min: 1, max: 1, run: ([n]) => Math.abs(n) },
    if: { min: 3, max: 3, run: ([test, yes, no]) => test ? yes : no },
};
const priority = { '==': 1, '!=': 1, '>': 1, '<': 1, '>=': 1, '<=': 1, '+': 2, '-': 2, '*': 3, '/': 3, '%': 3 };
export function parseExpression(source) {
    if (!source || source.length > 2000)
        throw new Error('Enter a calculation of at most 2,000 characters.');
    const tokens = [];
    const pattern = /\s*(\[[a-zA-Z][\w.-]*\]|\d+(?:\.\d+)?|[a-z]+|==|!=|>=|<=|[+\-*/%(),<>])/gy;
    let at = 0;
    while (at < source.trimEnd().length) {
        pattern.lastIndex = at;
        const match = pattern.exec(source);
        if (!match)
            throw new Error(`Invalid calculation near character ${at + 1}. Use [field ID], numbers and approved functions.`);
        tokens.push(match[1]);
        at = pattern.lastIndex;
        if (tokens.length > 500)
            throw new Error('Calculation is too complex.');
    }
    let cursor = 0;
    const parse = (level = 0, depth = 0) => {
        if (depth > 30)
            throw new Error('Calculation nesting is too deep.');
        const token = tokens[cursor++];
        let left;
        if (token === '-' || token === '+')
            left = { kind: 'unary', op: token, child: parse(4, depth + 1) };
        else if (token === '(') {
            left = parse(0, depth + 1);
            if (tokens[cursor++] !== ')')
                throw new Error('Missing closing parenthesis.');
        }
        else if (token?.startsWith('['))
            left = { kind: 'field', id: token.slice(1, -1) };
        else if (/^\d/.test(token || ''))
            left = { kind: 'number', value: Number(token) };
        else if (functions[token] && tokens[cursor++] === '(') {
            const args = [];
            if (tokens[cursor] !== ')')
                do {
                    args.push(parse(0, depth + 1));
                } while (tokens[cursor] === ',' && ++cursor);
            if (tokens[cursor++] !== ')')
                throw new Error('Missing closing function parenthesis.');
            left = { kind: 'call', name: token, args };
        }
        else
            throw new Error('Unknown calculation function or value.');
        while ((priority[tokens[cursor]] || 0) > level) {
            const op = tokens[cursor++];
            left = { kind: 'binary', op, left, right: parse(priority[op], depth + 1) };
        }
        return left;
    };
    const result = parse();
    if (cursor !== tokens.length)
        throw new Error('Unexpected value in calculation.');
    return result;
}
export function expressionReferences(source) {
    const result = new Set();
    const walk = (node) => {
        if (node.kind === 'field')
            result.add(node.id);
        if (node.kind === 'unary')
            walk(node.child);
        if (node.kind === 'binary') {
            walk(node.left);
            walk(node.right);
        }
        if (node.kind === 'call')
            node.args.forEach(walk);
    };
    walk(parseExpression(source));
    return [...result];
}
function numeric(value) {
    if (value === undefined || value === null || value === '')
        return 0;
    if (typeof value === 'boolean')
        return value ? 1 : 0;
    if (typeof value !== 'number' || !Number.isFinite(value))
        throw new Error('Calculations require numeric answers.');
    return value;
}
export function calculate(source, answers) {
    const evaluate = (node) => {
        if (node.kind === 'number')
            return node.value;
        if (node.kind === 'field') {
            const [id, child] = node.id.split('.');
            const value = answers[id];
            if (child)
                return Array.isArray(value) ? value.map(row => numeric(row && typeof row === 'object' && !Array.isArray(row) ? row[child] : undefined)) : [];
            return numeric(value);
        }
        const scalar = (part) => {
            const value = evaluate(part);
            if (Array.isArray(value))
                throw new Error('Use sum, min or max for repeated values.');
            return value;
        };
        if (node.kind === 'unary')
            return (node.op === '-' ? -1 : 1) * scalar(node.child);
        if (node.kind === 'call') {
            const fn = functions[node.name], args = node.args.flatMap(evaluate);
            if (args.length < fn.min || args.length > fn.max) {
                if (node.name === 'sum' && args.length === 0)
                    return 0;
                throw new Error(`Invalid number of arguments for ${node.name}.`);
            }
            return fn.run(args);
        }
        const a = scalar(node.left), b = scalar(node.right);
        const ops = {
            '+': () => a + b, '-': () => a - b, '*': () => a * b,
            '/': () => a / b, '%': () => a % b, '==': () => Number(a === b), '!=': () => Number(a !== b),
            '>': () => Number(a > b), '<': () => Number(a < b), '>=': () => Number(a >= b), '<=': () => Number(a <= b),
        };
        return ops[node.op]();
    };
    const result = evaluate(parseExpression(source));
    if (Array.isArray(result) || !Number.isFinite(result))
        throw new Error('Calculation must produce a finite number (check division by zero).');
    return result;
}
