/**
 * MCP 工具 inputSchema 的 JSON Schema 预处理
 *
 * 移植自 @langchain/mcp-adapters 的 tools.ts（MIT License）：
 *   - dereferenceJsonSchema：把 $defs/$definitions 里的 $ref 内联展开
 *     （部分 JSON Schema 校验器与 LLM API 不解析 $ref）
 *   - simplifyJsonSchemaForLLM：摊平 allOf/anyOf/oneOf、剥离 if/then/else/not
 *     等顶层组合关键字，生成 OpenAI 等工具调用 API 可接受的 schema
 */

/**
 * 将 JSON Schema 中的 $ref 指针内联为 $defs/definitions 中的定义
 */
function dereferenceJsonSchema(schema: Record<string, any>): Record<string, any> {
    const definitions = schema.$defs ?? schema.definitions ?? {};

    function resolveRefs(obj: any, visitedRefs: Set<string> = new Set()): any {
        if (typeof obj !== "object" || obj === null) return obj;
        if (obj.$ref && typeof obj.$ref === "string") {
            const refPath: string = obj.$ref;
            const match = refPath.match(/^#\/\$defs\/(.+)$/) ?? refPath.match(/^#\/definitions\/(.+)$/);
            if (match) {
                const definition = definitions[match[1]];
                if (definition) {
                    // 循环引用防御：退化为空对象，避免无限递归
                    if (visitedRefs.has(refPath)) return { type: "object" };
                    const newVisited = new Set(visitedRefs);
                    newVisited.add(refPath);
                    const { $ref: _ref, ...restOfObj } = obj;
                    return { ...resolveRefs(definition, newVisited), ...restOfObj };
                }
            }
            return obj;
        }
        const result: Record<string, any> = {};
        for (const [key, value] of Object.entries(obj)) {
            if (key === "$defs" || key === "definitions") continue;
            if (Array.isArray(value)) result[key] = value.map(item => (typeof item === "object" && item !== null ? resolveRefs(item, visitedRefs) : item));
            else if (typeof value === "object" && value !== null) result[key] = resolveRefs(value, visitedRefs);
            else result[key] = value;
        }
        return result;
    }

    return resolveRefs(schema);
}

/**
 * 深合并两个 JSON Schema 对象：
 * 数组拼接（enum 去重）、对象递归合并、基本类型覆盖
 */
function deepMergeSchemas(target: Record<string, any>, source: Record<string, any>): Record<string, any> {
    const result: Record<string, any> = { ...target };
    for (const [key, sourceValue] of Object.entries(source)) {
        const targetValue = result[key];
        if (key === "required" && Array.isArray(targetValue)) {
            result[key] = [...new Set([...targetValue, ...(Array.isArray(sourceValue) ? sourceValue : [])])];
        } else if (key === "const") {
            const values = new Set<any>();
            if (Array.isArray(result.enum)) result.enum.forEach(v => values.add(v));
            if (result.const !== undefined) values.add(result.const);
            values.add(sourceValue);
            delete result.const;
            result.enum = [...values];
        } else if (key === "enum" && Array.isArray(sourceValue)) {
            const values = new Set<any>();
            if (Array.isArray(targetValue)) targetValue.forEach(v => values.add(v));
            if (result.const !== undefined) {
                values.add(result.const);
                delete result.const;
            }
            sourceValue.forEach(v => values.add(v));
            result[key] = [...values];
        } else if (key === "properties" && typeof targetValue === "object" && targetValue !== null && typeof sourceValue === "object" && sourceValue !== null) {
            const mergedProps = { ...targetValue };
            for (const [propKey, propValue] of Object.entries(sourceValue)) {
                const existing = mergedProps[propKey];
                mergedProps[propKey] = (existing && typeof existing === "object" && propValue && typeof propValue === "object")
                    ? deepMergeSchemas(existing as Record<string, any>, propValue as Record<string, any>)
                    : propValue;
            }
            result[key] = mergedProps;
        } else if (Array.isArray(sourceValue) && Array.isArray(targetValue)) {
            result[key] = [...targetValue, ...sourceValue];
        } else if (typeof sourceValue === "object" && sourceValue !== null && !Array.isArray(sourceValue)
            && typeof targetValue === "object" && targetValue !== null && !Array.isArray(targetValue)) {
            result[key] = deepMergeSchemas(targetValue, sourceValue);
        } else {
            result[key] = sourceValue;
        }
    }
    return result;
}

/**
 * 从 if/then/else 条件 schema 中提取并合并 properties / required
 */
function extractPropertiesFromConditional(schema: Record<string, any>): Record<string, any> {
    let result: Record<string, any> = {};
    for (const branch of [schema.then, schema.else]) {
        const b = branch as Record<string, any> | undefined;
        if (b && typeof b === "object") {
            if (b.properties) result = deepMergeSchemas(result, { properties: b.properties });
            if (b.required) result.required = [...new Set([...(result.required || []), ...b.required])];
        }
    }
    return result;
}

/**
 * 为 LLM 工具调用 API 简化 JSON Schema：
 *   - allOf 合并进主 schema；anyOf/oneOf 摊平为对象属性合并
 *   - if/then/else / not / $schema / unevaluatedProperties 剥离（提取其中的属性）
 * 递归应用到嵌套 schema
 */
export function simplifyJsonSchemaForLLM(schema: Record<string, any>): Record<string, any> {
    if (typeof schema !== "object" || schema === null) return schema;
    const {
        allOf, anyOf, oneOf, not: _not, if: schemaIf, then: schemaThen, else: schemaElse,
        $schema: _$schema, unevaluatedProperties: _unevaluatedProperties, ...baseSchema
    } = schema;
    let result: Record<string, any> = { ...baseSchema };

    if (schemaIf || schemaThen || schemaElse) {
        const conditionalProps = extractPropertiesFromConditional({ if: schemaIf, then: schemaThen, else: schemaElse });
        result = deepMergeSchemas(result, conditionalProps);
    }

    if (Array.isArray(allOf)) {
        for (const subSchema of allOf) {
            if (subSchema?.if || subSchema?.then || subSchema?.else) {
                result = deepMergeSchemas(result, extractPropertiesFromConditional(subSchema));
            }
            result = deepMergeSchemas(result, simplifyJsonSchemaForLLM(subSchema));
        }
    }

    const unionSchemas = anyOf || oneOf;
    if (Array.isArray(unionSchemas) && unionSchemas.length > 0) {
        const schemasToMerge = unionSchemas.filter((s: any) => typeof s === "object" && s !== null && (s.type === "object" || s.properties));
        const mergedProperties: Record<string, any> = {};
        const requiredSets: Set<string>[] = [];
        for (const subSchema of schemasToMerge) {
            const simplified = simplifyJsonSchemaForLLM(subSchema);
            if (simplified.properties) Object.assign(mergedProperties, simplified.properties);
            if (Array.isArray(simplified.required)) requiredSets.push(new Set(simplified.required));
            if (simplified.type && !result.type) result.type = simplified.type;
        }
        if (Object.keys(mergedProperties).length > 0) {
            result.properties = { ...result.properties, ...mergedProperties };
        }
        if (requiredSets.length > 0) {
            // 各分支 required 的交集：所有分支都要求的字段才是必填
            const commonRequired = requiredSets.reduce((acc, set) => new Set([...acc].filter(x => set.has(x))));
            if (commonRequired.size > 0) result.required = [...new Set([...(result.required || []), ...commonRequired])];
        }
    }

    if (result.properties && !result.type) result.type = "object";
    if (result.properties) {
        const simplifiedProperties: Record<string, any> = {};
        for (const [propName, propSchema] of Object.entries(result.properties)) {
            simplifiedProperties[propName] = (typeof propSchema === "object" && propSchema !== null)
                ? simplifyJsonSchemaForLLM(propSchema)
                : propSchema;
        }
        result.properties = simplifiedProperties;
    }
    if (result.items) {
        if (Array.isArray(result.items)) result.items = result.items.map(item => (typeof item === "object" && item !== null ? simplifyJsonSchemaForLLM(item) : item));
        else if (typeof result.items === "object" && result.items !== null) result.items = simplifyJsonSchemaForLLM(result.items);
    }
    if (typeof result.additionalProperties === "object" && result.additionalProperties !== null) {
        result.additionalProperties = simplifyJsonSchemaForLLM(result.additionalProperties);
    }
    return result;
}

/**
 * 工具 inputSchema 的完整预处理入口：解引用 + LLM 兼容简化
 */
export function prepareToolSchema(inputSchema: Record<string, any>): Record<string, any> {
    const schema = { ...inputSchema };
    if (!schema.properties) schema.properties = {};
    return simplifyJsonSchemaForLLM(dereferenceJsonSchema(schema));
}
