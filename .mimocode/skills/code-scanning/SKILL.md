---
name: code-scanning
description: Scan code for bugs, optimization opportunities, and risks
---

# Code Scanning Skill

Systematically scan code for issues, optimizations, and potential bugs.

## When to Use

- User asks to "仔细扫描" (carefully scan), "检查" (check), or "分析" (analyze) a module
- After significant refactoring to verify correctness
- Before releases to catch potential issues

## Scanning Process

### 1. Understand the Module
- Read the main service file and its interface
- Check DI tokens and dependencies
- Review storage/database schema if applicable

### 2. Check for Common Issues
- **Type Safety**: Missing type annotations, unsafe casts
- **Error Handling**: Try/catch blocks, error propagation
- **Resource Management**: File handles, database connections
- **Concurrency**: Race conditions, async/await issues
- **Edge Cases**: Null/undefined handling, empty arrays

### 3. Optimization Opportunities
- **Performance**: N+1 queries, unnecessary re-renders
- **Memory**: Large object allocations, memory leaks
- **Code Duplication**: Repeated patterns that could be extracted

### 4. Security Risks
- **Input Validation**: User input sanitization
- **SQL Injection**: Parameterized queries
- **File Path Traversal**: Path validation

## Output Format

```markdown
## Module: [Module Name]

### Issues Found
1. [Issue]: [Description] - [Severity: High/Medium/Low]

### Optimizations
1. [Optimization]: [Description] - [Impact: Performance/Readability/Maintainability]

### Recommendations
1. [Recommendation]: [Description]
```

## Example Scan

```typescript
// Before scanning
async function getData(id: string) {
  return await db.query(`SELECT * FROM users WHERE id = ${id}`);
}

// After scanning
// Issue: SQL injection vulnerability (High)
// Fix: Use parameterized query
async function getData(id: string) {
  return await db.query('SELECT * FROM users WHERE id = ?', [id]);
}
```
