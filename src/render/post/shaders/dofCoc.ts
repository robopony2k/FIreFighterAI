export const dofCocFragmentShader = `
  uniform sampler2D uDepthTex;
  uniform float uFocusDistance;
  uniform float uFocusRange;
  uniform float uAperture;
  uniform float uCameraNear;
  uniform float uCameraFar;

  varying vec2 vUv;

  float linearizeDepth(float depthSample) {
    float z = depthSample * 2.0 - 1.0;
    return (2.0 * uCameraNear * uCameraFar) / max(1e-5, uCameraFar + uCameraNear - z * (uCameraFar - uCameraNear));
  }

  void main() {
    float rawDepth = texture2D(uDepthTex, vUv).x;
    if (rawDepth >= 0.999999) {
      gl_FragColor = vec4(0.5, 0.0, 1.0, 1.0);
      return;
    }

    float linearDepth = linearizeDepth(rawDepth);
    float signedCoc = clamp(
      (linearDepth - uFocusDistance) / max(uFocusRange, 1e-3),
      -1.0,
      1.0
    ) * max(uAperture, 0.0);
    signedCoc = clamp(signedCoc, -1.0, 1.0);

    float depth01 = clamp(
      (linearDepth - uCameraNear) / max(1e-3, uCameraFar - uCameraNear),
      0.0,
      1.0
    );

    gl_FragColor = vec4(signedCoc * 0.5 + 0.5, abs(signedCoc), depth01, 1.0);
  }
`;
