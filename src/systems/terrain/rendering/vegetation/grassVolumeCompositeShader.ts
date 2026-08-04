export const grassVolumeCompositeFragmentShader = `
  precision highp float;

  uniform sampler2D uSceneColor;
  uniform sampler2D uGrassLayer;
  varying vec2 vUv;

  void main() {
    vec4 grassLayer = texture2D(uGrassLayer, vUv);
    vec3 sceneColour = texture2D(uSceneColor, vUv).rgb;
    vec3 colour = grassLayer.rgb + sceneColour * (1.0 - clamp(grassLayer.a, 0.0, 1.0));
    gl_FragColor = vec4(max(colour, vec3(0.0)), 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
