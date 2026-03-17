export const dofBlurFragmentShader = `
  uniform sampler2D uInputTex;
  uniform sampler2D uCocTex;
  uniform sampler2D uDepthTex;
  uniform vec2 uInvResolution;
  uniform vec2 uBlurDirection;
  uniform float uBlurScale;
  uniform float uMaxBlurRadius;
  uniform float uBlurSign;
  uniform float uDepthRejectDistance;
  uniform float uCameraNear;
  uniform float uCameraFar;

  varying vec2 vUv;

  float linearizeDepth(float depthSample) {
    float z = depthSample * 2.0 - 1.0;
    return (2.0 * uCameraNear * uCameraFar) / max(1e-5, uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
  }

  float sampleLinearDepth(vec2 uv) {
    float rawDepth = texture2D(uDepthTex, uv).x;
    if (rawDepth >= 0.999999) {
      return uCameraFar;
    }
    return linearizeDepth(rawDepth);
  }

  float decodeSignedCoc(vec2 uv) {
    return texture2D(uCocTex, uv).r * 2.0 - 1.0;
  }

  vec3 sampleColor(vec2 uv) {
    return texture2D(uInputTex, uv).rgb;
  }

  float tapWeight(float tapDepth, float centerDepth, float tapCoc, float kernelWeight) {
    float signMatch = step(0.0, tapCoc * uBlurSign);
    float cocWeight = smoothstep(0.03, 1.0, abs(tapCoc));
    float depthDelta = abs(tapDepth - centerDepth);
    float depthWeight = 1.0 - smoothstep(uDepthRejectDistance, uDepthRejectDistance * 2.6, depthDelta);
    return kernelWeight * signMatch * cocWeight * depthWeight;
  }

  void main() {
    float centerCoc = decodeSignedCoc(vUv);
    float signMatch = centerCoc * uBlurSign;
    float radius = max(0.0, signMatch) * uMaxBlurRadius * max(uBlurScale, 0.01);
    vec3 baseColor = sampleColor(vUv);

    if (radius <= 0.05) {
      gl_FragColor = vec4(baseColor, 1.0);
      return;
    }

    float centerDepth = sampleLinearDepth(vUv);
    vec2 blurStep = uBlurDirection * uInvResolution * radius;

    vec3 color = baseColor * 0.227027;
    float weightSum = 0.227027;

    vec2 offset1 = blurStep * 1.384615;
    vec2 offset2 = blurStep * 3.230769;

    vec2 uvA = clamp(vUv + offset1, 0.0, 1.0);
    vec2 uvB = clamp(vUv - offset1, 0.0, 1.0);
    vec2 uvC = clamp(vUv + offset2, 0.0, 1.0);
    vec2 uvD = clamp(vUv - offset2, 0.0, 1.0);

    float weightA = tapWeight(sampleLinearDepth(uvA), centerDepth, decodeSignedCoc(uvA), 0.316216);
    float weightB = tapWeight(sampleLinearDepth(uvB), centerDepth, decodeSignedCoc(uvB), 0.316216);
    float weightC = tapWeight(sampleLinearDepth(uvC), centerDepth, decodeSignedCoc(uvC), 0.070270);
    float weightD = tapWeight(sampleLinearDepth(uvD), centerDepth, decodeSignedCoc(uvD), 0.070270);

    color += sampleColor(uvA) * weightA;
    color += sampleColor(uvB) * weightB;
    color += sampleColor(uvC) * weightC;
    color += sampleColor(uvD) * weightD;
    weightSum += weightA + weightB + weightC + weightD;

    if (weightSum <= 1e-4) {
      gl_FragColor = vec4(baseColor, 1.0);
      return;
    }

    gl_FragColor = vec4(color / weightSum, 1.0);
  }
`;
