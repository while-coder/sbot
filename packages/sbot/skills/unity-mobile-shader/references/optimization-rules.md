# Mobile Shader Optimization Rules

Complete reference for Unity mobile shader optimization.

## Table of Contents
1. [Precision Rules](#precision-rules)
2. [Texture Optimization](#texture-optimization)
3. [Math Optimization](#math-optimization)
4. [Branching & Flow Control](#branching--flow-control)
5. [Varying/Interpolator Limits](#varyinginterpolator-limits)
6. [Alpha & Transparency](#alpha--transparency)
7. [Lighting Optimization](#lighting-optimization)
8. [Batching & Instancing](#batching--instancing)
9. [Memory & Bandwidth](#memory--bandwidth)
10. [Platform-Specific](#platform-specific)

---

## Precision Rules

### Precision Types

| Type | Bits | Range | Use Case |
|------|------|-------|----------|
| `float` | 32 | ±3.4e38 | Positions, UVs, world-space calculations |
| `half` | 16 | ±6.5e4 | Colors, directions, local calculations |
| `fixed` | 11 | -2 to +2 | Normalized values 0-1 (Built-in only, maps to half in URP) |

### Rules

```hlsl
// Vertex shader - use float for positions
float4 vertex : POSITION;
float3 worldPos = mul(unity_ObjectToWorld, vertex).xyz;

// Fragment shader - use half for most calculations
half4 albedo = SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, uv);
half3 normal = UnpackNormal(normalSample);
half NdotL = saturate(dot(normal, lightDir));

// Pack when possible
half4 colorAndAlpha;  // Not half3 color; half alpha;
```

### Common Mistakes

```hlsl
// BAD: float everywhere
float4 color = tex2D(_MainTex, uv);
float3 normal = UnpackNormal(bump);

// GOOD: appropriate precision
half4 color = tex2D(_MainTex, uv);
half3 normal = UnpackNormal(bump);
```

---

## Texture Optimization

### Sample Count Limits

| GPU Tier | Max Samples/Pass |
|----------|------------------|
| Low-end (Mali-400, Adreno 3xx) | 4 |
| Mid-range (Mali-T7xx, Adreno 4xx) | 6 |
| High-end (Mali-G7x, Adreno 6xx+) | 8 |

**Target 4 samples for broad compatibility.**

### Channel Packing

```hlsl
// BAD: 4 separate textures
sampler2D _MetallicTex;    // R only
sampler2D _AOTex;          // R only
sampler2D _HeightTex;      // R only
sampler2D _SmoothnessTex;  // R only

// GOOD: 1 packed texture
sampler2D _MaskTex;        // R=Metallic, G=AO, B=Height, A=Smoothness
half4 mask = tex2D(_MaskTex, uv);
half metallic = mask.r;
half ao = mask.g;
half height = mask.b;
half smoothness = mask.a;
```

### Dependent Texture Reads

```hlsl
// BAD: UV depends on texture sample (dependent read)
half2 distortion = tex2D(_DistortionTex, uv).rg;
half4 color = tex2D(_MainTex, uv + distortion);

// BETTER: Calculate UVs in vertex shader when possible
// v2f struct:
float4 uvMain_uvDistort : TEXCOORD0;
```

### Texture Formats

| Format | Use Case | Compression |
|--------|----------|-------------|
| ASTC 4x4 | High quality | Best balance |
| ASTC 6x6 | General use | Good compression |
| ETC2 | Android compatibility | Wide support |
| PVRTC | iOS legacy | Older devices |

---

## Math Optimization

### Expensive Operations (AVOID)

```hlsl
// EXPENSIVE - avoid in fragment shader
pow(x, n)           // Use multiplication chains
sqrt(x)             // Use rsqrt() or approximations
sin(), cos()        // Use lookup textures
atan(), asin()      // Very expensive
log(), exp()        // Avoid when possible
normalize()         // Move to vertex shader
length()            // Use dot(v,v) for comparisons
```

### Optimized Alternatives

```hlsl
// Power functions
// BAD
half spec = pow(NdotH, 64.0);
// GOOD - Approximate with multiplication
half spec = NdotH * NdotH;  // ^2
spec = spec * spec;          // ^4
spec = spec * spec;          // ^8
spec = spec * spec;          // ^16
spec = spec * spec;          // ^32
spec = spec * spec;          // ^64

// Square root
// BAD
half dist = length(offset);
// GOOD
half distSq = dot(offset, offset);
// Compare with squared values instead

// Normalize
// BAD (in fragment)
half3 normalWS = normalize(i.normalWS);
// GOOD (normalize in vertex, interpolation usually acceptable)
// Or use rsqrt:
half3 normalWS = i.normalWS * rsqrt(dot(i.normalWS, i.normalWS));

// Trigonometry - use approximations
half sinApprox(half x) {
    // Bhaskara approximation for 0-PI
    return 4.0 * x * (PI - x) / (5.0 * PI * PI - 4.0 * x * (PI - x));
}
```

### MAD Operations

```hlsl
// GPUs optimize Multiply-Add (MAD) operations
// GOOD: Uses MAD
result = a * b + c;

// BAD: Separate operations
temp = a * b;
result = temp + c;
```

---

## Branching & Flow Control

### Static vs Dynamic Branching

```hlsl
// STATIC BRANCH (OK) - Evaluated at compile time
#if defined(_NORMALMAP)
    half3 normal = UnpackNormal(tex2D(_BumpMap, uv));
#else
    half3 normal = half3(0, 0, 1);
#endif

// DYNAMIC BRANCH (AVOID) - Runtime evaluation
if (_UseNormalMap > 0.5) {  // BAD
    normal = UnpackNormal(tex2D(_BumpMap, uv));
}
```

### Branch Elimination Techniques

```hlsl
// Pattern 1: step() + lerp()
// BAD
if (x > threshold) color = colorA; else color = colorB;
// GOOD
color = lerp(colorB, colorA, step(threshold, x));

// Pattern 2: saturate() clamping
// BAD
if (value < 0) value = 0;
if (value > 1) value = 1;
// GOOD
value = saturate(value);

// Pattern 3: max/min
// BAD
if (a > b) result = a; else result = b;
// GOOD
result = max(a, b);

// Pattern 4: Conditional texture sampling
// BAD
if (useMask) alpha = tex2D(_MaskTex, uv).a;
else alpha = 1;
// GOOD - Sample always, multiply by flag
alpha = lerp(1, tex2D(_MaskTex, uv).a, _UseMask);
```

### Loop Unrolling

```hlsl
// BAD: Dynamic loop
for (int i = 0; i < _IterCount; i++) { ... }

// GOOD: Fixed loop with unroll hint
[unroll]
for (int i = 0; i < 4; i++) { ... }

// BEST: Manual unroll for critical paths
result += sample0 * weight0;
result += sample1 * weight1;
result += sample2 * weight2;
result += sample3 * weight3;
```

---

## Varying/Interpolator Limits

### Hardware Limits

| GPU | Max Varyings |
|-----|--------------|
| OpenGL ES 2.0 | 8 vec4 |
| OpenGL ES 3.0+ | 16 vec4 |
| Metal | 16 vec4 |

**Target 8 for compatibility.**

### Packing Strategies

```hlsl
// BAD: Separate varyings
struct v2f {
    float2 uv : TEXCOORD0;           // 1 vec2
    float3 worldPos : TEXCOORD1;     // 1 vec3
    float3 worldNormal : TEXCOORD2;  // 1 vec3
    float3 worldTangent : TEXCOORD3; // 1 vec3
    float3 worldBinormal : TEXCOORD4;// 1 vec3
    float fogFactor : TEXCOORD5;     // 1 float
    float4 shadowCoord : TEXCOORD6;  // 1 vec4
};  // Total: 7 slots used inefficiently

// GOOD: Packed varyings
struct v2f {
    float4 uv_fog : TEXCOORD0;       // xy=uv, zw=fog/extra
    float4 worldPos_x : TEXCOORD1;   // xyz=pos, w=tangent.x
    float4 worldNormal_y : TEXCOORD2;// xyz=normal, w=tangent.y
    float4 tbn_z : TEXCOORD3;        // xy=tangent.zw, zw=binormal.xy
    float4 shadowCoord : TEXCOORD4;  // Shadow
};  // Total: 5 slots
```

---

## Alpha & Transparency

### Render Queue Order

```hlsl
// Performance order (best to worst):
Tags { "Queue" = "Geometry" }        // Opaque - fastest
Tags { "Queue" = "AlphaTest" }       // Alpha test - breaks early-Z
Tags { "Queue" = "Transparent" }     // Alpha blend - overdraw cost
```

### Alpha Testing Problems

```hlsl
// BAD: clip() breaks early-Z rejection
half4 frag(v2f i) : SV_Target {
    half4 color = tex2D(_MainTex, i.uv);
    clip(color.a - _Cutoff);  // GPU can't skip occluded pixels
    return color;
}

// BETTER: Use alpha blending for soft edges
Blend SrcAlpha OneMinusSrcAlpha

// OR: Use opaque with threshold in texture
// Bake hard cutoff into texture alpha
```

### Transparency Optimization

```hlsl
// 1. Minimize transparent surface area
// 2. Use simpler shaders for transparent objects
// 3. Disable depth write for pure transparency
ZWrite Off

// 4. Sort transparent objects back-to-front
// 5. Consider dithered transparency for hair/foliage
half dither = frac(dot(screenPos.xy, float2(12.9898, 78.233)));
clip(alpha - dither);
```

---

## Lighting Optimization

### Light Count

| Complexity | Lights | Notes |
|------------|--------|-------|
| Simple | 1 directional | Best performance |
| Medium | 1 dir + 2 point | Use vertex lighting for points |
| Complex | 4+ | Consider baked lighting |

### Lighting Techniques

```hlsl
// 1. Vertex Lighting (fastest for additional lights)
// Calculate in vertex shader, interpolate
v2f vert(appdata v) {
    o.diffuse = ShadeVertexLights(worldPos, worldNormal);
}

// 2. Spherical Harmonics (ambient)
half3 ambient = ShadeSH9(half4(worldNormal, 1.0));

// 3. Light Probes
half3 ambient = SampleSH(worldNormal);

// 4. Baked Lighting (best for static)
half4 lightmap = SAMPLE_TEXTURE2D(unity_Lightmap, samplerunity_Lightmap, lightmapUV);
```

### Specular Approximations

```hlsl
// Full Blinn-Phong (expensive)
half spec = pow(max(0, dot(normal, halfDir)), _Shininess);

// Approximate specular
half NdotH = max(0, dot(normal, halfDir));
half spec = NdotH * NdotH * NdotH * NdotH;  // Fixed ^4 power

// Or use lookup texture for specular power
half spec = tex2D(_SpecLUT, half2(NdotH, _Shininess / 128.0)).r;
```

---

## Batching & Instancing

### SRP Batcher (URP)

```hlsl
// Enable SRP Batcher compatibility
CBUFFER_START(UnityPerMaterial)
    float4 _MainTex_ST;
    half4 _BaseColor;
    half _Smoothness;
CBUFFER_END

// All material properties must be in UnityPerMaterial CBUFFER
```

### GPU Instancing

```hlsl
// Built-in
#pragma multi_compile_instancing

UNITY_INSTANCING_BUFFER_START(Props)
    UNITY_DEFINE_INSTANCED_PROP(half4, _Color)
UNITY_INSTANCING_BUFFER_END(Props)

v2f vert(appdata v) {
    UNITY_SETUP_INSTANCE_ID(v);
    // ...
}

half4 frag(v2f i) : SV_Target {
    half4 color = UNITY_ACCESS_INSTANCED_PROP(Props, _Color);
    // ...
}
```

### Static Batching Requirements

- Same material
- Marked as Static
- < 64k vertices per batch

### Dynamic Batching Requirements

- < 300 vertices
- < 900 vertex attributes
- Same material
- No multi-pass

---

## Memory & Bandwidth

### Texture Size Guidelines

| Object Type | Max Size | Format |
|-------------|----------|--------|
| Characters | 512x512 | ASTC 4x4 |
| Props | 256x256 | ASTC 6x6 |
| Environment | 1024x1024 | ASTC 6x6 |
| UI | Power of 2 | ASTC 4x4 |

### Mipmaps

```hlsl
// Enable for 3D objects (reduces aliasing, saves bandwidth)
// Disable for UI (fixed size on screen)

// Bias mipmaps for sharpness on mobile
half4 color = tex2Dbias(_MainTex, half4(uv, 0, -0.5));
```

### Render Target

```hlsl
// Avoid multiple render targets on mobile
// Use single RT when possible
// R11G11B10 format for HDR instead of RGBA16F
```

---

## Platform-Specific

### iOS (Metal)

```hlsl
// Metal prefers:
- half precision
- Texture arrays over atlases
- Early fragment tests

#pragma require metal
```

### Android (Vulkan/OpenGL ES)

```hlsl
// Wide variety of GPUs - target lowest common denominator
// Mali GPUs: Avoid dependent texture reads
// Adreno GPUs: Minimize register pressure

// OpenGL ES 2.0 fallback for old devices
SubShader {
    Tags { "RenderType"="Opaque" }
    LOD 100  // Low LOD for fallback
    // Simplified shader
}
```

### Common Shader Variants

```hlsl
// Control variant count
#pragma skip_variants SHADOWS_SOFT
#pragma skip_variants LIGHTMAP_SHADOW_MIXING
#pragma skip_variants DYNAMICLIGHTMAP_ON

// Limit keywords
#pragma shader_feature_local _NORMALMAP  // Local = less variants
```
