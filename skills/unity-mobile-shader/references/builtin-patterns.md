# Built-in Pipeline Mobile Shader Patterns

Complete shader templates for Unity Built-in Render Pipeline on mobile.

## Table of Contents
1. [Built-in Shader Structure](#built-in-shader-structure)
2. [Unlit](#unlit)
3. [Toon](#toon)
4. [PBR-Lite](#pbr-lite)
5. [Vertex Lit](#vertex-lit)
6. [Particles](#particles)
7. [UI](#ui)
8. [Multi-Pass Techniques](#multi-pass-techniques)

---

## Built-in Shader Structure

### Basic Template

```hlsl
Shader "Mobile/BuiltIn/ShaderName"
{
    Properties
    {
        _MainTex ("Main Texture", 2D) = "white" {}
        _Color ("Tint Color", Color) = (1,1,1,1)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 100

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #pragma multi_compile_instancing

            // Target ES 2.0 for maximum compatibility
            #pragma target 2.0

            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_FOG_COORDS(1)
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                UNITY_TRANSFER_INSTANCE_ID(v, o);

                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                UNITY_SETUP_INSTANCE_ID(i);
                fixed4 col = tex2D(_MainTex, i.uv) * _Color;
                UNITY_APPLY_FOG(i.fogCoord, col);
                return col;
            }
            ENDCG
        }
    }

    FallBack "Mobile/Diffuse"
}
```

---

## Unlit

### Simple Unlit

```hlsl
Shader "Mobile/BuiltIn/Unlit"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)
        [Toggle] _AlphaClip ("Alpha Clip", Float) = 0
        _Cutoff ("Cutoff", Range(0,1)) = 0.5
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 100

        Pass
        {
            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fog
            #pragma shader_feature_local _ALPHACLIP_ON
            #pragma multi_compile_instancing
            #pragma target 2.0

            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            fixed _Cutoff;

            struct appdata
            {
                float4 vertex : POSITION;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                UNITY_FOG_COORDS(1)
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 col = tex2D(_MainTex, i.uv) * _Color;

                #ifdef _ALPHACLIP_ON
                    clip(col.a - _Cutoff);
                #endif

                UNITY_APPLY_FOG(i.fogCoord, col);
                return col;
            }
            ENDCG
        }

        // Shadow caster
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            ZWrite On
            ZTest LEqual
            Cull Off

            CGPROGRAM
            #pragma vertex vertShadow
            #pragma fragment fragShadow
            #pragma shader_feature_local _ALPHACLIP_ON
            #pragma multi_compile_shadowcaster
            #pragma multi_compile_instancing
            #pragma target 2.0

            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            fixed _Cutoff;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f_shadow
            {
                V2F_SHADOW_CASTER;
                float2 uv : TEXCOORD1;
            };

            v2f_shadow vertShadow(appdata v)
            {
                v2f_shadow o;
                UNITY_SETUP_INSTANCE_ID(v);
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(o);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                return o;
            }

            fixed4 fragShadow(v2f_shadow i) : SV_Target
            {
                #ifdef _ALPHACLIP_ON
                    fixed alpha = tex2D(_MainTex, i.uv).a * _Color.a;
                    clip(alpha - _Cutoff);
                #endif
                SHADOW_CASTER_FRAGMENT(i);
            }
            ENDCG
        }
    }

    FallBack "Mobile/Diffuse"
}
```

---

## Toon

### Mobile Toon Shader

```hlsl
Shader "Mobile/BuiltIn/Toon"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)

        [Header(Toon)]
        _ShadowColor ("Shadow Color", Color) = (0.5, 0.5, 0.6, 1)
        _ShadowThreshold ("Shadow Threshold", Range(0,1)) = 0.5
        _ShadowSmooth ("Shadow Smoothness", Range(0,0.5)) = 0.02

        [Header(Rim)]
        [Toggle] _RimEnabled ("Rim Enabled", Float) = 0
        _RimColor ("Rim Color", Color) = (1,1,1,1)
        _RimPower ("Rim Power", Range(1,10)) = 4

        [Header(Outline)]
        _OutlineColor ("Outline Color", Color) = (0,0,0,1)
        _OutlineWidth ("Outline Width", Range(0,0.1)) = 0.01
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 200

        // Main toon pass
        Pass
        {
            Tags { "LightMode" = "ForwardBase" }

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _RIMENABLED_ON
            #pragma multi_compile_fwdbase
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma target 2.0

            #include "UnityCG.cginc"
            #include "AutoLight.cginc"
            #include "Lighting.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            fixed4 _ShadowColor;
            half _ShadowThreshold;
            half _ShadowSmooth;
            fixed4 _RimColor;
            half _RimPower;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 normalWorld : TEXCOORD1;
                float3 viewDir : TEXCOORD2;
                SHADOW_COORDS(3)
                UNITY_FOG_COORDS(4)
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);

                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.normalWorld = UnityObjectToWorldNormal(v.normal);

                float3 worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.viewDir = normalize(_WorldSpaceCameraPos - worldPos);

                TRANSFER_SHADOW(o);
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 albedo = tex2D(_MainTex, i.uv) * _Color;

                // Toon lighting
                float3 normal = normalize(i.normalWorld);
                float NdotL = dot(normal, _WorldSpaceLightPos0.xyz);

                // Remap to 0-1 and apply toon threshold
                float toon = smoothstep(_ShadowThreshold - _ShadowSmooth,
                                       _ShadowThreshold + _ShadowSmooth,
                                       NdotL * 0.5 + 0.5);

                // Shadow
                fixed shadow = SHADOW_ATTENUATION(i);
                toon *= shadow;

                // Blend shadow and lit
                fixed3 lighting = lerp(_ShadowColor.rgb, _LightColor0.rgb, toon);
                fixed3 color = albedo.rgb * lighting;

                // Ambient
                color += albedo.rgb * UNITY_LIGHTMODEL_AMBIENT.rgb;

                // Rim
                #ifdef _RIMENABLED_ON
                    float rim = 1.0 - saturate(dot(i.viewDir, normal));
                    rim = pow(rim, _RimPower);
                    color += _RimColor.rgb * rim;
                #endif

                fixed4 finalColor = fixed4(color, albedo.a);
                UNITY_APPLY_FOG(i.fogCoord, finalColor);
                return finalColor;
            }
            ENDCG
        }

        // Outline pass
        Pass
        {
            Name "Outline"
            Tags { "LightMode" = "Always" }

            Cull Front
            ZWrite On

            CGPROGRAM
            #pragma vertex vertOutline
            #pragma fragment fragOutline
            #pragma multi_compile_instancing
            #pragma target 2.0

            #include "UnityCG.cginc"

            fixed4 _OutlineColor;
            float _OutlineWidth;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
            };

            v2f vertOutline (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);

                // Expand along normal
                float3 normal = normalize(v.normal);
                float3 posOS = v.vertex.xyz + normal * _OutlineWidth;
                o.pos = UnityObjectToClipPos(float4(posOS, 1));
                return o;
            }

            fixed4 fragOutline (v2f i) : SV_Target
            {
                return _OutlineColor;
            }
            ENDCG
        }

        // Shadow caster
        UsePass "Mobile/BuiltIn/Unlit/ShadowCaster"
    }

    FallBack "Mobile/Diffuse"
}
```

---

## PBR-Lite

### Simplified PBR

```hlsl
Shader "Mobile/BuiltIn/PBR-Lite"
{
    Properties
    {
        _MainTex ("Albedo", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)

        [Header(PBR)]
        _Metallic ("Metallic", Range(0,1)) = 0
        _Smoothness ("Smoothness", Range(0,1)) = 0.5

        [Header(Normal)]
        [Toggle(_NORMALMAP)] _NormalMapEnabled ("Normal Map", Float) = 0
        _BumpMap ("Normal Map", 2D) = "bump" {}
        _BumpScale ("Normal Scale", Range(0,2)) = 1

        [Header(Emission)]
        [Toggle(_EMISSION)] _EmissionEnabled ("Emission", Float) = 0
        _EmissionMap ("Emission", 2D) = "white" {}
        [HDR] _EmissionColor ("Emission Color", Color) = (0,0,0,1)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 300

        Pass
        {
            Tags { "LightMode" = "ForwardBase" }

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _NORMALMAP
            #pragma shader_feature_local _EMISSION
            #pragma multi_compile_fwdbase
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma target 3.0

            #include "UnityCG.cginc"
            #include "AutoLight.cginc"
            #include "Lighting.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            half _Metallic;
            half _Smoothness;

            #ifdef _NORMALMAP
                sampler2D _BumpMap;
                half _BumpScale;
            #endif

            #ifdef _EMISSION
                sampler2D _EmissionMap;
                fixed4 _EmissionColor;
            #endif

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float4 tangent : TANGENT;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 worldPos : TEXCOORD1;
                float3 normalWorld : TEXCOORD2;
                #ifdef _NORMALMAP
                    float4 tangentWorld : TEXCOORD3;
                    float3 binormalWorld : TEXCOORD4;
                #endif
                SHADOW_COORDS(5)
                UNITY_FOG_COORDS(6)
            };

            // Simple GGX approximation
            half D_GGX_Mobile(half NdotH, half roughness)
            {
                half a2 = roughness * roughness;
                half d = NdotH * NdotH * (a2 - 1.0) + 1.0;
                return a2 / (UNITY_PI * d * d + 0.0001);
            }

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);

                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.normalWorld = UnityObjectToWorldNormal(v.normal);

                #ifdef _NORMALMAP
                    o.tangentWorld = float4(UnityObjectToWorldDir(v.tangent.xyz), v.tangent.w);
                    o.binormalWorld = cross(o.normalWorld, o.tangentWorld.xyz) * v.tangent.w;
                #endif

                TRANSFER_SHADOW(o);
                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                // Sample textures
                fixed4 albedo = tex2D(_MainTex, i.uv) * _Color;

                // Normal
                float3 normalWorld;
                #ifdef _NORMALMAP
                    float3 normalTS = UnpackScaleNormal(tex2D(_BumpMap, i.uv), _BumpScale);
                    normalWorld = normalize(
                        normalTS.x * i.tangentWorld.xyz +
                        normalTS.y * i.binormalWorld +
                        normalTS.z * i.normalWorld
                    );
                #else
                    normalWorld = normalize(i.normalWorld);
                #endif

                // View and light directions
                float3 viewDir = normalize(_WorldSpaceCameraPos - i.worldPos);
                float3 lightDir = normalize(_WorldSpaceLightPos0.xyz);
                float3 halfDir = normalize(lightDir + viewDir);

                // PBR terms
                half NdotL = saturate(dot(normalWorld, lightDir));
                half NdotH = saturate(dot(normalWorld, halfDir));
                half NdotV = saturate(dot(normalWorld, viewDir));

                half roughness = 1.0 - _Smoothness;
                roughness = max(roughness * roughness, 0.002);

                // Diffuse
                half3 diffuse = albedo.rgb * (1.0 - _Metallic);

                // Specular
                half3 specColor = lerp(0.04, albedo.rgb, _Metallic);
                half specular = D_GGX_Mobile(NdotH, roughness) * NdotL;

                // Shadow
                fixed shadow = SHADOW_ATTENUATION(i);

                // Final lighting
                half3 lighting = _LightColor0.rgb * NdotL * shadow;
                half3 color = diffuse * lighting + specColor * specular * _LightColor0.rgb * shadow;

                // Ambient (SH approximation)
                half3 ambient = ShadeSH9(half4(normalWorld, 1.0)) * diffuse;
                color += ambient;

                // Emission
                #ifdef _EMISSION
                    color += tex2D(_EmissionMap, i.uv).rgb * _EmissionColor.rgb;
                #endif

                fixed4 finalColor = fixed4(color, albedo.a);
                UNITY_APPLY_FOG(i.fogCoord, finalColor);
                return finalColor;
            }
            ENDCG
        }

        // Additional lights pass
        Pass
        {
            Tags { "LightMode" = "ForwardAdd" }
            Blend One One
            ZWrite Off

            CGPROGRAM
            #pragma vertex vertAdd
            #pragma fragment fragAdd
            #pragma multi_compile_fwdadd_fullshadows
            #pragma multi_compile_instancing
            #pragma target 3.0

            #include "UnityCG.cginc"
            #include "AutoLight.cginc"
            #include "Lighting.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            half _Metallic;
            half _Smoothness;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f_add
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                float3 worldPos : TEXCOORD1;
                float3 normalWorld : TEXCOORD2;
                LIGHTING_COORDS(3, 4)
            };

            v2f_add vertAdd (appdata v)
            {
                v2f_add o;
                UNITY_SETUP_INSTANCE_ID(v);

                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;
                o.normalWorld = UnityObjectToWorldNormal(v.normal);

                TRANSFER_VERTEX_TO_FRAGMENT(o);
                return o;
            }

            fixed4 fragAdd (v2f_add i) : SV_Target
            {
                fixed4 albedo = tex2D(_MainTex, i.uv) * _Color;
                float3 normalWorld = normalize(i.normalWorld);

                // Light direction (handles point/spot)
                #ifdef USING_DIRECTIONAL_LIGHT
                    float3 lightDir = normalize(_WorldSpaceLightPos0.xyz);
                #else
                    float3 lightDir = normalize(_WorldSpaceLightPos0.xyz - i.worldPos);
                #endif

                half NdotL = saturate(dot(normalWorld, lightDir));
                half3 diffuse = albedo.rgb * (1.0 - _Metallic);

                // Attenuation
                UNITY_LIGHT_ATTENUATION(atten, i, i.worldPos);

                half3 color = diffuse * _LightColor0.rgb * NdotL * atten;
                return fixed4(color, 1);
            }
            ENDCG
        }

        // Shadow caster
        Pass
        {
            Name "ShadowCaster"
            Tags { "LightMode" = "ShadowCaster" }

            ZWrite On
            ZTest LEqual

            CGPROGRAM
            #pragma vertex vertShadow
            #pragma fragment fragShadow
            #pragma multi_compile_shadowcaster
            #pragma multi_compile_instancing
            #pragma target 2.0

            #include "UnityCG.cginc"

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f_shadow
            {
                V2F_SHADOW_CASTER;
            };

            v2f_shadow vertShadow(appdata v)
            {
                v2f_shadow o;
                UNITY_SETUP_INSTANCE_ID(v);
                TRANSFER_SHADOW_CASTER_NORMALOFFSET(o);
                return o;
            }

            fixed4 fragShadow(v2f_shadow i) : SV_Target
            {
                SHADOW_CASTER_FRAGMENT(i);
            }
            ENDCG
        }
    }

    FallBack "Mobile/Diffuse"
}
```

---

## Vertex Lit

### Per-Vertex Lighting

```hlsl
Shader "Mobile/BuiltIn/VertexLit"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Color", Color) = (1,1,1,1)
    }

    SubShader
    {
        Tags { "RenderType"="Opaque" "Queue"="Geometry" }
        LOD 50

        Pass
        {
            Tags { "LightMode" = "ForwardBase" }

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_fwdbase
            #pragma multi_compile_fog
            #pragma multi_compile_instancing
            #pragma target 2.0

            #include "UnityCG.cginc"
            #include "Lighting.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;

            struct appdata
            {
                float4 vertex : POSITION;
                float3 normal : NORMAL;
                float2 uv : TEXCOORD0;
                UNITY_VERTEX_INPUT_INSTANCE_ID
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                float2 uv : TEXCOORD0;
                fixed3 lighting : TEXCOORD1;
                UNITY_FOG_COORDS(2)
            };

            v2f vert (appdata v)
            {
                v2f o;
                UNITY_SETUP_INSTANCE_ID(v);

                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);

                // All lighting in vertex shader
                float3 worldNormal = UnityObjectToWorldNormal(v.normal);
                float3 worldPos = mul(unity_ObjectToWorld, v.vertex).xyz;

                // Main directional light
                float NdotL = saturate(dot(worldNormal, _WorldSpaceLightPos0.xyz));
                fixed3 lighting = _LightColor0.rgb * NdotL;

                // Ambient/SH
                lighting += ShadeSH9(half4(worldNormal, 1.0));

                // Vertex lights (4 point lights)
                #ifdef VERTEXLIGHT_ON
                    lighting += Shade4PointLights(
                        unity_4LightPosX0, unity_4LightPosY0, unity_4LightPosZ0,
                        unity_LightColor[0].rgb, unity_LightColor[1].rgb,
                        unity_LightColor[2].rgb, unity_LightColor[3].rgb,
                        unity_4LightAtten0, worldPos, worldNormal
                    );
                #endif

                o.lighting = lighting;

                UNITY_TRANSFER_FOG(o, o.pos);
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 col = tex2D(_MainTex, i.uv) * _Color;
                col.rgb *= i.lighting;
                UNITY_APPLY_FOG(i.fogCoord, col);
                return col;
            }
            ENDCG
        }
    }

    FallBack "Mobile/VertexLit"
}
```

---

## Particles

### Mobile Particle Shader

```hlsl
Shader "Mobile/BuiltIn/Particles"
{
    Properties
    {
        _MainTex ("Particle Texture", 2D) = "white" {}
        [HDR] _Color ("Color", Color) = (1,1,1,1)

        [Header(Blending)]
        [Enum(UnityEngine.Rendering.BlendMode)] _SrcBlend ("Src Blend", Float) = 5
        [Enum(UnityEngine.Rendering.BlendMode)] _DstBlend ("Dst Blend", Float) = 10
        [Toggle] _ZWrite ("Z Write", Float) = 0

        [Header(Soft Particles)]
        [Toggle(_SOFTPARTICLES)] _SoftParticles ("Soft Particles", Float) = 0
        _InvFade ("Soft Factor", Range(0.01, 3)) = 1
    }

    SubShader
    {
        Tags
        {
            "RenderType"="Transparent"
            "Queue"="Transparent"
            "IgnoreProjector"="True"
            "PreviewType"="Plane"
        }

        LOD 100

        Pass
        {
            Blend [_SrcBlend] [_DstBlend]
            ZWrite [_ZWrite]
            Cull Off
            Lighting Off

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma shader_feature_local _SOFTPARTICLES
            #pragma multi_compile_particles
            #pragma target 2.0

            #include "UnityCG.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;

            #ifdef _SOFTPARTICLES
                UNITY_DECLARE_DEPTH_TEXTURE(_CameraDepthTexture);
                float _InvFade;
            #endif

            struct appdata
            {
                float4 vertex : POSITION;
                fixed4 color : COLOR;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                fixed4 color : COLOR;
                float2 uv : TEXCOORD0;
                #ifdef _SOFTPARTICLES
                    float4 projPos : TEXCOORD1;
                #endif
            };

            v2f vert (appdata v)
            {
                v2f o;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.color = v.color;

                #ifdef _SOFTPARTICLES
                    o.projPos = ComputeScreenPos(o.pos);
                    COMPUTE_EYEDEPTH(o.projPos.z);
                #endif

                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 col = tex2D(_MainTex, i.uv) * i.color * _Color;

                #ifdef _SOFTPARTICLES
                    float sceneZ = LinearEyeDepth(SAMPLE_DEPTH_TEXTURE_PROJ(_CameraDepthTexture, UNITY_PROJ_COORD(i.projPos)));
                    float partZ = i.projPos.z;
                    float fade = saturate(_InvFade * (sceneZ - partZ));
                    col.a *= fade;
                #endif

                return col;
            }
            ENDCG
        }
    }

    FallBack "Particles/Alpha Blended"
}
```

---

## UI

### Mobile UI Shader

```hlsl
Shader "Mobile/BuiltIn/UI"
{
    Properties
    {
        _MainTex ("Texture", 2D) = "white" {}
        _Color ("Tint", Color) = (1,1,1,1)

        _StencilComp ("Stencil Comparison", Float) = 8
        _Stencil ("Stencil ID", Float) = 0
        _StencilOp ("Stencil Operation", Float) = 0
        _StencilWriteMask ("Stencil Write Mask", Float) = 255
        _StencilReadMask ("Stencil Read Mask", Float) = 255

        _ColorMask ("Color Mask", Float) = 15

        [Toggle(UNITY_UI_ALPHACLIP)] _UseUIAlphaClip ("Use Alpha Clip", Float) = 0
    }

    SubShader
    {
        Tags
        {
            "Queue"="Transparent"
            "IgnoreProjector"="True"
            "RenderType"="Transparent"
            "PreviewType"="Plane"
            "CanUseSpriteAtlas"="True"
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
            Name "Default"

            CGPROGRAM
            #pragma vertex vert
            #pragma fragment frag
            #pragma multi_compile_local _ UNITY_UI_CLIP_RECT
            #pragma multi_compile_local _ UNITY_UI_ALPHACLIP
            #pragma target 2.0

            #include "UnityCG.cginc"
            #include "UnityUI.cginc"

            sampler2D _MainTex;
            float4 _MainTex_ST;
            fixed4 _Color;
            fixed4 _TextureSampleAdd;
            float4 _ClipRect;

            struct appdata
            {
                float4 vertex : POSITION;
                fixed4 color : COLOR;
                float2 uv : TEXCOORD0;
            };

            struct v2f
            {
                float4 pos : SV_POSITION;
                fixed4 color : COLOR;
                float2 uv : TEXCOORD0;
                float4 worldPos : TEXCOORD1;
            };

            v2f vert (appdata v)
            {
                v2f o;
                o.worldPos = v.vertex;
                o.pos = UnityObjectToClipPos(v.vertex);
                o.uv = TRANSFORM_TEX(v.uv, _MainTex);
                o.color = v.color * _Color;
                return o;
            }

            fixed4 frag (v2f i) : SV_Target
            {
                fixed4 col = (tex2D(_MainTex, i.uv) + _TextureSampleAdd) * i.color;

                #ifdef UNITY_UI_CLIP_RECT
                    col.a *= UnityGet2DClipping(i.worldPos.xy, _ClipRect);
                #endif

                #ifdef UNITY_UI_ALPHACLIP
                    clip(col.a - 0.001);
                #endif

                return col;
            }
            ENDCG
        }
    }

    FallBack "UI/Default"
}
```

---

## Multi-Pass Techniques

### Reflection Pass Example

```hlsl
// Add after main pass for planar reflections
Pass
{
    Name "Reflection"
    Tags { "LightMode" = "Always" }

    Blend One One
    ZWrite Off

    CGPROGRAM
    #pragma vertex vertReflect
    #pragma fragment fragReflect
    #pragma target 2.0

    #include "UnityCG.cginc"

    sampler2D _ReflectionTex;
    half _ReflectionStrength;

    struct appdata
    {
        float4 vertex : POSITION;
    };

    struct v2f
    {
        float4 pos : SV_POSITION;
        float4 screenPos : TEXCOORD0;
    };

    v2f vertReflect(appdata v)
    {
        v2f o;
        o.pos = UnityObjectToClipPos(v.vertex);
        o.screenPos = ComputeScreenPos(o.pos);
        return o;
    }

    fixed4 fragReflect(v2f i) : SV_Target
    {
        float2 screenUV = i.screenPos.xy / i.screenPos.w;
        fixed4 refl = tex2D(_ReflectionTex, screenUV);
        return refl * _ReflectionStrength;
    }
    ENDCG
}
```

### Common Includes (Built-in)

```hlsl
// Core
#include "UnityCG.cginc"

// Lighting
#include "Lighting.cginc"
#include "AutoLight.cginc"

// Shadows
// Use SHADOW_COORDS, TRANSFER_SHADOW, SHADOW_ATTENUATION macros

// UI
#include "UnityUI.cginc"

// Instancing
#include "UnityInstancing.cginc"
```
