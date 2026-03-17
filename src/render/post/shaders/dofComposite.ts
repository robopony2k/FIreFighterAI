export const dofCompositeFragmentShader = `
  uniform sampler2D uSceneTex;
  uniform sampler2D uCocTex;
  uniform sampler2D uFarBlurTex;
  uniform sampler2D uNearBlurTex;
  uniform float uNearBlurEnabled;

  varying vec2 vUv;

  float decodeSignedCoc(vec2 uv) {
    return texture2D(uCocTex, uv).r * 2.0 - 1.0;
  }

  void main() {
    vec4 src = texture2D(uSceneTex, vUv);
    float signedCoc = decodeSignedCoc(vUv);
    float farWeight = smoothstep(0.035, 0.95, max(signedCoc, 0.0));
    float nearWeight = uNearBlurEnabled > 0.5
      ? smoothstep(0.035, 0.95, max(-signedCoc, 0.0))
      : 0.0;

    vec3 color = src.rgb;
    vec3 farBlur = texture2D(uFarBlurTex, vUv).rgb;
    color = mix(color, farBlur, farWeight);

    if (nearWeight > 0.0) {
      vec3 nearBlur = texture2D(uNearBlurTex, vUv).rgb;
      color = mix(color, nearBlur, nearWeight);
    }

    gl_FragColor = vec4(color, src.a);
  }
`;
