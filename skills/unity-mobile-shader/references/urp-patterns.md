# URP Mobile Shader Patterns

Complete shader templates for Universal Render Pipeline on mobile.

## Table of Contents
1. [URP Shader Structure](#urp-shader-structure)
2. [Unlit](#unlit)
3. [Toon](#toon)
4. [PBR-Lite](#pbr-lite)
5. [Vertex Lit](#vertex-lit)
6. [Particles](#particles)
7. [UI](#ui)
8. [Common Includes](#common-includes)

---

## URP Shader Structure

### Basic Template

```hlsl
Shader "Mobile/URP/ShaderName"
{
    Properties
    {
        _BaseMap("Base Map", 2D) = "white" {}
        _BaseColor("Base Color", Color) = (1,1,1,1)
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }

        LOD 100

        Pass
        {
            Name "ForwardLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            // Mobile variants
            #pragma prefer_hlslcc gles
            #pragma exclude_renderers d3d11_9x
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            // SRP Batcher compatibility
            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            Varyings vert(Attributes input)
            {
                Varyings output = (Varyings)0;
                UNITY_SETUP_INSTANCE_ID(input);
                UNITY_TRANSFER_INSTANCE_ID(input, output);

                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(input);
                half4 color = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv);
                return color * _BaseColor;
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
```

---

## Unlit

### Simple Unlit (UI, Particles, Skybox)

```hlsl
Shader "Mobile/URP/Unlit"
{
    Properties
    {
        _BaseMap("Base Map", 2D) = "white" {}
        _BaseColor("Base Color", Color) = (1,1,1,1)
        [Toggle] _AlphaClip("Alpha Clip", Float) = 0
        _Cutoff("Cutoff", Range(0,1)) = 0.5
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }

        LOD 100

        Pass
        {
            Name "Unlit"
            Tags { "LightMode" = "UniversalForward" }

            Cull Back
            ZWrite On
            ZTest LEqual

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _ALPHACLIP_ON
            #pragma multi_compile_instancing

            #pragma prefer_hlslcc gles
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Cutoff;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half4 color = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;

                #ifdef _ALPHACLIP_ON
                    clip(color.a - _Cutoff);
                #endif

                return color;
            }
            ENDHLSL
        }

        // Shadow caster pass for shadows
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            ZWrite On
            ZTest LEqual
            ColorMask 0

            HLSLPROGRAM
            #pragma vertex ShadowVert
            #pragma fragment ShadowFrag
            #pragma shader_feature_local _ALPHACLIP_ON
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Cutoff;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
            };

            Varyings ShadowVert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                float3 positionWS = TransformObjectToWorld(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.positionCS = TransformWorldToHClip(ApplyShadowBias(positionWS, normalWS, _LightDirection));
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                return output;
            }

            half4 ShadowFrag(Varyings input) : SV_Target
            {
                #ifdef _ALPHACLIP_ON
                    half alpha = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv).a * _BaseColor.a;
                    clip(alpha - _Cutoff);
                #endif
                return 0;
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
```

---

## Toon

### Mobile Toon Shader

```hlsl
Shader "Mobile/URP/Toon"
{
    Properties
    {
        _BaseMap("Base Map", 2D) = "white" {}
        _BaseColor("Base Color", Color) = (1,1,1,1)

        [Header(Toon Settings)]
        _ShadowColor("Shadow Color", Color) = (0.5, 0.5, 0.6, 1)
        _ShadowThreshold("Shadow Threshold", Range(0,1)) = 0.5
        _ShadowSmoothness("Shadow Smoothness", Range(0,0.5)) = 0.02

        [Header(Rim)]
        [Toggle] _RimEnabled("Rim Enabled", Float) = 0
        _RimColor("Rim Color", Color) = (1,1,1,1)
        _RimPower("Rim Power", Range(1,10)) = 4

        [Header(Outline)]
        [Toggle] _OutlineEnabled("Outline Enabled", Float) = 0
        _OutlineColor("Outline Color", Color) = (0,0,0,1)
        _OutlineWidth("Outline Width", Range(0,0.1)) = 0.01
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }

        LOD 200

        // Main Pass
        Pass
        {
            Name "ToonForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _RIMENABLED_ON
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS
            #pragma multi_compile_instancing

            #pragma prefer_hlslcc gles
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half4 _ShadowColor;
                half _ShadowThreshold;
                half _ShadowSmoothness;
                half4 _RimColor;
                half _RimPower;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWS : TEXCOORD1;
                float3 viewDirWS : TEXCOORD2;
                float4 shadowCoord : TEXCOORD3;
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                VertexPositionInputs posInputs = GetVertexPositionInputs(input.positionOS.xyz);
                output.positionCS = posInputs.positionCS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.normalWS = TransformObjectToWorldNormal(input.normalOS);
                output.viewDirWS = GetWorldSpaceViewDir(posInputs.positionWS);

                #ifdef _MAIN_LIGHT_SHADOWS
                    output.shadowCoord = GetShadowCoord(posInputs);
                #else
                    output.shadowCoord = 0;
                #endif

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half4 baseColor = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;

                // Main light
                Light mainLight = GetMainLight(input.shadowCoord);
                half3 normalWS = normalize(input.normalWS);

                // Toon shading - hard edge with slight smoothing
                half NdotL = dot(normalWS, mainLight.direction);
                half toonNdotL = smoothstep(_ShadowThreshold - _ShadowSmoothness,
                                            _ShadowThreshold + _ShadowSmoothness,
                                            NdotL * 0.5 + 0.5);

                // Apply shadow attenuation
                toonNdotL *= mainLight.shadowAttenuation;

                // Blend between shadow and lit color
                half3 lighting = lerp(_ShadowColor.rgb, mainLight.color, toonNdotL);

                half3 finalColor = baseColor.rgb * lighting;

                // Rim lighting
                #ifdef _RIMENABLED_ON
                    half3 viewDir = normalize(input.viewDirWS);
                    half rim = 1.0 - saturate(dot(viewDir, normalWS));
                    rim = pow(rim, _RimPower);
                    finalColor += _RimColor.rgb * rim;
                #endif

                return half4(finalColor, baseColor.a);
            }
            ENDHLSL
        }

        // Outline Pass
        Pass
        {
            Name "Outline"
            Tags { "LightMode" = "SRPDefaultUnlit" }

            Cull Front
            ZWrite On

            HLSLPROGRAM
            #pragma vertex outlineVert
            #pragma fragment outlineFrag
            #pragma shader_feature_local _OUTLINEENABLED_ON
            #pragma multi_compile_instancing

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half4 _ShadowColor;
                half _ShadowThreshold;
                half _ShadowSmoothness;
                half4 _RimColor;
                half _RimPower;
                half4 _OutlineColor;
                half _OutlineWidth;
            CBUFFER_END

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
            };

            Varyings outlineVert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                #ifdef _OUTLINEENABLED_ON
                    float3 normalOS = normalize(input.normalOS);
                    float3 posOS = input.positionOS.xyz + normalOS * _OutlineWidth;
                    output.positionCS = TransformObjectToHClip(posOS);
                #else
                    output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                #endif

                return output;
            }

            half4 outlineFrag(Varyings input) : SV_Target
            {
                #ifdef _OUTLINEENABLED_ON
                    return _OutlineColor;
                #else
                    discard;
                    return 0;
                #endif
            }
            ENDHLSL
        }

        // Shadow pass
        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
    }

    FallBack "Mobile/URP/Unlit"
}
```

---

## PBR-Lite

### Simplified PBR for Mobile

```hlsl
Shader "Mobile/URP/PBR-Lite"
{
    Properties
    {
        _BaseMap("Base Map", 2D) = "white" {}
        _BaseColor("Base Color", Color) = (1,1,1,1)

        [Header(PBR)]
        _Metallic("Metallic", Range(0,1)) = 0
        _Smoothness("Smoothness", Range(0,1)) = 0.5

        [Header(Normal)]
        [Toggle(_NORMALMAP)] _NormalMapEnabled("Normal Map", Float) = 0
        _BumpMap("Normal Map", 2D) = "bump" {}
        _BumpScale("Normal Scale", Range(0,2)) = 1

        [Header(Emission)]
        [Toggle(_EMISSION)] _EmissionEnabled("Emission", Float) = 0
        _EmissionMap("Emission Map", 2D) = "white" {}
        [HDR] _EmissionColor("Emission Color", Color) = (0,0,0,1)
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }

        LOD 300

        Pass
        {
            Name "PBRLiteForward"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag

            #pragma shader_feature_local _NORMALMAP
            #pragma shader_feature_local _EMISSION
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX
            #pragma multi_compile_instancing

            #pragma prefer_hlslcc gles
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _Metallic;
                half _Smoothness;
                half _BumpScale;
                half4 _EmissionColor;
            CBUFFER_END

            TEXTURE2D(_BaseMap);        SAMPLER(sampler_BaseMap);
            TEXTURE2D(_BumpMap);        SAMPLER(sampler_BumpMap);
            TEXTURE2D(_EmissionMap);    SAMPLER(sampler_EmissionMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float4 tangentOS : TANGENT;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 positionWS : TEXCOORD1;
                float3 normalWS : TEXCOORD2;
                #ifdef _NORMALMAP
                    float4 tangentWS : TEXCOORD3;
                #endif
                half3 vertexLight : TEXCOORD4;
                float4 shadowCoord : TEXCOORD5;
            };

            // Simplified GGX for mobile
            half D_GGX_Mobile(half NdotH, half roughness)
            {
                half a2 = roughness * roughness;
                half d = NdotH * NdotH * (a2 - 1.0) + 1.0;
                return a2 / (PI * d * d);
            }

            Varyings vert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                VertexPositionInputs posInputs = GetVertexPositionInputs(input.positionOS.xyz);
                VertexNormalInputs normalInputs = GetVertexNormalInputs(input.normalOS, input.tangentOS);

                output.positionCS = posInputs.positionCS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);
                output.positionWS = posInputs.positionWS;
                output.normalWS = normalInputs.normalWS;

                #ifdef _NORMALMAP
                    output.tangentWS = float4(normalInputs.tangentWS, input.tangentOS.w);
                #endif

                // Vertex lighting for additional lights
                #ifdef _ADDITIONAL_LIGHTS_VERTEX
                    output.vertexLight = VertexLighting(posInputs.positionWS, normalInputs.normalWS);
                #else
                    output.vertexLight = 0;
                #endif

                #ifdef _MAIN_LIGHT_SHADOWS
                    output.shadowCoord = GetShadowCoord(posInputs);
                #else
                    output.shadowCoord = 0;
                #endif

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                // Sample textures
                half4 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;

                // Normal
                half3 normalWS;
                #ifdef _NORMALMAP
                    half3 normalTS = UnpackNormalScale(
                        SAMPLE_TEXTURE2D(_BumpMap, sampler_BumpMap, input.uv), _BumpScale);
                    half3 bitangent = input.tangentWS.w * cross(input.normalWS, input.tangentWS.xyz);
                    normalWS = normalize(normalTS.x * input.tangentWS.xyz +
                                        normalTS.y * bitangent +
                                        normalTS.z * input.normalWS);
                #else
                    normalWS = normalize(input.normalWS);
                #endif

                // Main light
                Light mainLight = GetMainLight(input.shadowCoord);
                half3 viewDirWS = normalize(GetWorldSpaceViewDir(input.positionWS));
                half3 halfDir = normalize(mainLight.direction + viewDirWS);

                // PBR calculations
                half NdotL = saturate(dot(normalWS, mainLight.direction));
                half NdotV = saturate(dot(normalWS, viewDirWS));
                half NdotH = saturate(dot(normalWS, halfDir));

                half roughness = 1.0 - _Smoothness;
                roughness = max(roughness * roughness, 0.002);

                // Simplified diffuse
                half3 diffuse = albedo.rgb * (1.0 - _Metallic);

                // Simplified specular
                half3 specColor = lerp(0.04, albedo.rgb, _Metallic);
                half specular = D_GGX_Mobile(NdotH, roughness);
                specular = specular * NdotL;

                // Combine
                half3 lighting = mainLight.color * mainLight.shadowAttenuation * NdotL;
                half3 color = diffuse * lighting + specColor * specular * mainLight.color;

                // Ambient (SH)
                half3 ambient = SampleSH(normalWS) * albedo.rgb * (1.0 - _Metallic);
                color += ambient;

                // Vertex lights
                color += diffuse * input.vertexLight;

                // Emission
                #ifdef _EMISSION
                    half3 emission = SAMPLE_TEXTURE2D(_EmissionMap, sampler_EmissionMap, input.uv).rgb;
                    color += emission * _EmissionColor.rgb;
                #endif

                return half4(color, albedo.a);
            }
            ENDHLSL
        }

        UsePass "Universal Render Pipeline/Lit/ShadowCaster"
        UsePass "Universal Render Pipeline/Lit/DepthOnly"
    }

    FallBack "Mobile/URP/Unlit"
}
```

---

## Vertex Lit

### Per-Vertex Lighting (Large Environments)

```hlsl
Shader "Mobile/URP/VertexLit"
{
    Properties
    {
        _BaseMap("Base Map", 2D) = "white" {}
        _BaseColor("Base Color", Color) = (1,1,1,1)
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Opaque"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Geometry"
        }

        LOD 50

        Pass
        {
            Name "VertexLit"
            Tags { "LightMode" = "UniversalForward" }

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile _ _MAIN_LIGHT_SHADOWS
            #pragma multi_compile _ _ADDITIONAL_LIGHTS_VERTEX
            #pragma multi_compile_instancing

            #pragma prefer_hlslcc gles
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float3 normalOS : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float2 uv : TEXCOORD0;
                half3 lighting : TEXCOORD1;  // All lighting computed per-vertex
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                VertexPositionInputs posInputs = GetVertexPositionInputs(input.positionOS.xyz);
                float3 normalWS = TransformObjectToWorldNormal(input.normalOS);

                output.positionCS = posInputs.positionCS;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);

                // Compute all lighting in vertex shader
                Light mainLight = GetMainLight();
                half NdotL = saturate(dot(normalWS, mainLight.direction));
                half3 lighting = mainLight.color * NdotL;

                // Add ambient
                lighting += SampleSH(normalWS);

                // Add vertex lights
                #ifdef _ADDITIONAL_LIGHTS_VERTEX
                    lighting += VertexLighting(posInputs.positionWS, normalWS);
                #endif

                output.lighting = lighting;

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half4 albedo = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv) * _BaseColor;
                return half4(albedo.rgb * input.lighting, albedo.a);
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
```

---

## Particles

### Mobile Particle Shader

```hlsl
Shader "Mobile/URP/Particles"
{
    Properties
    {
        _BaseMap("Base Map", 2D) = "white" {}
        [HDR] _BaseColor("Base Color", Color) = (1,1,1,1)

        [Header(Blending)]
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend("Src Blend", Float) = 5
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend("Dst Blend", Float) = 10
        [Toggle] _ZWrite("Z Write", Float) = 0

        [Header(Soft Particles)]
        [Toggle(_SOFTPARTICLES)] _SoftParticles("Soft Particles", Float) = 0
        _SoftFactor("Soft Factor", Range(0.01, 3)) = 1
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent"
            "IgnoreProjector" = "True"
        }

        LOD 100

        Pass
        {
            Name "Particles"
            Tags { "LightMode" = "UniversalForward" }

            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            Cull Off

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _SOFTPARTICLES
            #pragma multi_compile_instancing

            #pragma prefer_hlslcc gles
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"
            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _BaseMap_ST;
                half4 _BaseColor;
                half _SoftFactor;
            CBUFFER_END

            TEXTURE2D(_BaseMap);
            SAMPLER(sampler_BaseMap);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
                #ifdef _SOFTPARTICLES
                    float4 projPos : TEXCOORD1;
                #endif
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                UNITY_SETUP_INSTANCE_ID(input);

                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.color = input.color;
                output.uv = TRANSFORM_TEX(input.uv, _BaseMap);

                #ifdef _SOFTPARTICLES
                    output.projPos = ComputeScreenPos(output.positionCS);
                    output.projPos.z = -TransformWorldToView(TransformObjectToWorld(input.positionOS.xyz)).z;
                #endif

                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half4 color = SAMPLE_TEXTURE2D(_BaseMap, sampler_BaseMap, input.uv);
                color *= input.color * _BaseColor;

                #ifdef _SOFTPARTICLES
                    float2 screenUV = input.projPos.xy / input.projPos.w;
                    float sceneDepth = LinearEyeDepth(SampleSceneDepth(screenUV), _ZBufferParams);
                    float particleDepth = input.projPos.z;
                    float fade = saturate((sceneDepth - particleDepth) * _SoftFactor);
                    color.a *= fade;
                #endif

                return color;
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
```

---

## UI

### Mobile UI Shader

```hlsl
Shader "Mobile/URP/UI"
{
    Properties
    {
        _MainTex("Main Texture", 2D) = "white" {}
        _Color("Tint", Color) = (1,1,1,1)

        [Header(Stencil)]
        _StencilComp("Stencil Comparison", Float) = 8
        _Stencil("Stencil ID", Float) = 0
        _StencilOp("Stencil Operation", Float) = 0
        _StencilWriteMask("Stencil Write Mask", Float) = 255
        _StencilReadMask("Stencil Read Mask", Float) = 255
        _ColorMask("Color Mask", Float) = 15
    }

    SubShader
    {
        Tags
        {
            "RenderType" = "Transparent"
            "RenderPipeline" = "UniversalPipeline"
            "Queue" = "Transparent"
            "IgnoreProjector" = "True"
            "PreviewType" = "Plane"
        }

        Stencil
        {
            Ref [_Stencil]
            Comp [_StencilComp]
            Pass [_StencilOp]
            ReadMask [_StencilReadMask]
            WriteMask [_StencilWriteMask]
        }

        Cull Off
        Lighting Off
        ZWrite Off
        ZTest [unity_GUIZTestMode]
        Blend SrcAlpha OneMinusSrcAlpha
        ColorMask [_ColorMask]

        Pass
        {
            Name "UI"

            HLSLPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_local _ UNITY_UI_CLIP_RECT
            #pragma multi_compile_local _ UNITY_UI_ALPHACLIP

            #pragma prefer_hlslcc gles
            #pragma target 2.0

            #include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

            CBUFFER_START(UnityPerMaterial)
                float4 _MainTex_ST;
                half4 _Color;
                half4 _TextureSampleAdd;
                float4 _ClipRect;
            CBUFFER_END

            TEXTURE2D(_MainTex);
            SAMPLER(sampler_MainTex);

            struct Attributes
            {
                float4 positionOS : POSITION;
                float4 color : COLOR;
                float2 uv : TEXCOORD0;
            };

            struct Varyings
            {
                float4 positionCS : SV_POSITION;
                half4 color : COLOR;
                float2 uv : TEXCOORD0;
                float4 worldPos : TEXCOORD1;
            };

            Varyings vert(Attributes input)
            {
                Varyings output;
                output.worldPos = input.positionOS;
                output.positionCS = TransformObjectToHClip(input.positionOS.xyz);
                output.uv = TRANSFORM_TEX(input.uv, _MainTex);
                output.color = input.color * _Color;
                return output;
            }

            half4 frag(Varyings input) : SV_Target
            {
                half4 color = (SAMPLE_TEXTURE2D(_MainTex, sampler_MainTex, input.uv) + _TextureSampleAdd) * input.color;

                #ifdef UNITY_UI_CLIP_RECT
                    half2 inside = step(_ClipRect.xy, input.worldPos.xy) * step(input.worldPos.xy, _ClipRect.zw);
                    color.a *= inside.x * inside.y;
                #endif

                #ifdef UNITY_UI_ALPHACLIP
                    clip(color.a - 0.001);
                #endif

                return color;
            }
            ENDHLSL
        }
    }

    FallBack "Hidden/Universal Render Pipeline/FallbackError"
}
```

---

## Common Includes

### Useful URP Includes

```hlsl
// Core functionality
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Core.hlsl"

// Lighting (main light, additional lights, shadows)
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Lighting.hlsl"

// Shadows only
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/Shadows.hlsl"

// Depth texture
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareDepthTexture.hlsl"

// Normal texture (for post-processing)
#include "Packages/com.unity.render-pipelines.universal/ShaderLibrary/DeclareNormalsTexture.hlsl"
```

### Common Macros

```hlsl
// Transform functions
TransformObjectToHClip(positionOS)      // Object to clip space
TransformObjectToWorld(positionOS)       // Object to world
TransformWorldToView(positionWS)         // World to view
TransformObjectToWorldNormal(normalOS)   // Normal transform

// Texture sampling
TEXTURE2D(textureName)
SAMPLER(samplerName)
SAMPLE_TEXTURE2D(tex, sampler, uv)
SAMPLE_TEXTURE2D_LOD(tex, sampler, uv, lod)

// Instancing
UNITY_VERTEX_INPUT_INSTANCE_ID
UNITY_SETUP_INSTANCE_ID(input)
UNITY_TRANSFER_INSTANCE_ID(input, output)

// SRP Batcher
CBUFFER_START(UnityPerMaterial)
CBUFFER_END
```
