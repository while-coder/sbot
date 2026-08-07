/**
 * 计算两个向量的余弦相似度，返回 [-1, 1]
 * @param precomputedNormA 预计算的向量 a 的模长（批量比较时可避免重复计算）
 */
export function cosineSimilarity(a: number[], b: number[], precomputedNormA?: number): number {
  let dotProduct = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normB += b[i] * b[i];
  }

  let normA = precomputedNormA;
  if (normA === undefined) {
    normA = 0;
    for (let i = 0; i < a.length; i++) normA += a[i] * a[i];
    normA = Math.sqrt(normA);
  }

  const denominator = normA * Math.sqrt(normB);
  return denominator === 0 ? 0 : dotProduct / denominator;
}
