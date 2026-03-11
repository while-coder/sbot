---
name: unity-mobile-shader
description: |
  Generate optimized Unity shaders for mobile platforms (iOS/Android). Use when:
  (1) Creating new shaders for mobile games
  (2) Optimizing existing shaders for mobile performance
  (3) Converting desktop shaders to mobile-friendly versions
  (4) Writing URP or Built-in pipeline shaders for mobile
  (5) Implementing specific effects (toon, PBR-lite, unlit, particles, UI) for mobile
---

# Unity Mobile Shader Generator

Generate performance-optimized shaders for Unity mobile platforms.

## Quick Start

1. Determine render pipeline: URP or Built-in
2. Choose shader type based on use case
3. Apply mobile optimization rules
4. Include appropriate fallbacks

## Pipeline Selection

| Pipeline | When to Use |
|----------|-------------|
| **URP** | New projects, better batching, modern features |
| **Built-in** | Legacy projects, specific built-in features needed |

## Shader Type Templates

### Unlit (Fastest)
- UI elements, particles, skyboxes
- No lighting calculations
- See [references/urp-patterns.md](references/urp-patterns.md#unlit) or [references/builtin-patterns.md](references/builtin-patterns.md#unlit)

### Toon/Cel Shading
- Stylized games, anime aesthetics
- Banded lighting, outline support
- See [references/urp-patterns.md](references/urp-patterns.md#toon) or [references/builtin-patterns.md](references/builtin-patterns.md#toon)

### PBR-Lite
- Realistic look with mobile constraints
- Simplified metallic/smoothness workflow
- See [references/urp-patterns.md](references/urp-patterns.md#pbr-lite) or [references/builtin-patterns.md](references/builtin-patterns.md#pbr-lite)

### Vertex Lit
- Large environments, terrain
- Per-vertex lighting for performance
- See [references/urp-patterns.md](references/urp-patterns.md#vertex-lit)

## Core Optimization Rules

**MUST follow these rules for ALL mobile shaders:**

### Precision
```hlsl
// Use lowest precision possible
half4 color;      // Prefer half (16-bit) for colors
fixed4 mask;      // Use fixed (11-bit) for 0-1 values (Built-in only)
float2 uv;        // float only for UVs and positions
```

### Texture Sampling
- Maximum 4 texture samples per pass
- Use texture atlases to reduce samples
- Combine masks into single RGBA texture (R=metallic, G=AO, A=smoothness)
- Avoid dependent texture reads

### Math Operations
```hlsl
// AVOID                    // PREFER
pow(x, 5.0)                 x * x * x * x * x
sin(), cos()                Lookup textures or approximations
normalize() in fragment     Normalize in vertex, pass as varying
length()                    dot(v, v) when comparing distances
```

### Branching
```hlsl
// AVOID dynamic branches
if (condition) { ... }

// PREFER
result = lerp(valueA, valueB, step(threshold, value));
```

### Varying Count
- Maximum 8 interpolators for broad compatibility
- Pack data: `float4 uvAndFog` instead of separate `float2 uv; float2 fog;`

### Alpha & Transparency
```hlsl
// AVOID alpha testing (clip/discard) - breaks early-Z
clip(alpha - 0.5);

// PREFER alpha blending or opaque
Blend SrcAlpha OneMinusSrcAlpha
```

## Detailed References

- **Full optimization rules**: [references/optimization-rules.md](references/optimization-rules.md)
- **URP shader patterns**: [references/urp-patterns.md](references/urp-patterns.md)
- **Built-in shader patterns**: [references/builtin-patterns.md](references/builtin-patterns.md)

## Output Checklist

Before delivering shader, verify:
- [ ] Correct precision qualifiers used
- [ ] Texture samples ≤ 4
- [ ] No unnecessary branches
- [ ] Varyings ≤ 8
- [ ] Fallback shader specified
- [ ] LOD levels if complex
- [ ] GPU Instancing support if applicable
- [ ] SRP Batcher compatible (URP)
