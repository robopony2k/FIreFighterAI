import {
  Color,
  LinearSRGBColorSpace,
  MeshStandardMaterial,
  SRGBColorSpace,
  type Texture
} from "three";
import type { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

const SPECULAR_GLOSSINESS_EXTENSION = "KHR_materials_pbrSpecularGlossiness";

type GLTFTextureInfo = {
  index: number;
  texCoord?: number;
  extensions?: Record<string, unknown>;
};

type GLTFMaterialExtension = {
  diffuseFactor?: number[];
  diffuseTexture?: GLTFTextureInfo;
  specularFactor?: number[];
  glossinessFactor?: number;
  specularGlossinessTexture?: GLTFTextureInfo;
};

type GLTFMaterialDef = {
  extensions?: Record<string, unknown>;
};

type GLTFParserLike = {
  json: { materials?: GLTFMaterialDef[] };
  assignTexture: (
    materialParams: Record<string, unknown>,
    mapName: string,
    mapDef: GLTFTextureInfo,
    colorSpace?: string
  ) => Promise<Texture | null>;
};

class GLTFMeshStandardSGMaterial extends MeshStandardMaterial {
  public isGLTFSpecularGlossinessMaterial = true;
  public declare specular: Color;
  public declare glossiness: number;
  public declare specularMap: Texture | null;
  public declare glossinessMap: Texture | null;
  private _extraUniforms: Record<string, { value: unknown }>;

  constructor(params: Record<string, unknown> = {}) {
    super();

    const specularMapParsFragmentChunk = [
      "#ifdef USE_SPECULARMAP",
      "  uniform sampler2D specularMap;",
      "#endif"
    ].join("\n");

    const glossinessMapParsFragmentChunk = [
      "#ifdef USE_GLOSSINESSMAP",
      "  uniform sampler2D glossinessMap;",
      "#endif"
    ].join("\n");

    const specularMapFragmentChunk = [
      "vec3 specularFactor = specular;",
      "#ifdef USE_SPECULARMAP",
      "  vec4 texelSpecular = texture2D( specularMap, vUv );",
      "  // sRGB decode handled by texture colorSpace.",
      "  specularFactor *= texelSpecular.rgb;",
      "#endif"
    ].join("\n");

    const glossinessMapFragmentChunk = [
      "float glossinessFactor = glossiness;",
      "#ifdef USE_GLOSSINESSMAP",
      "  vec4 texelGlossiness = texture2D( glossinessMap, vUv );",
      "  // Reads channel A, compatible with glTF Specular-Glossiness (RGBA).",
      "  glossinessFactor *= texelGlossiness.a;",
      "#endif"
    ].join("\n");

    const lightPhysicalFragmentChunk = [
      "PhysicalMaterial material;",
      "material.diffuseColor = diffuseColor.rgb * ( 1. - max( specularFactor.r, max( specularFactor.g, specularFactor.b ) ) );",
      "material.diffuseContribution = material.diffuseColor;",
      "material.metalness = 0.0;",
      "vec3 dxy = max( abs( dFdx( nonPerturbedNormal ) ), abs( dFdy( nonPerturbedNormal ) ) );",
      "float geometryRoughness = max( max( dxy.x, dxy.y ), dxy.z );",
      "material.roughness = max( 1.0 - glossinessFactor, 0.0525 );",
      "material.roughness += geometryRoughness;",
      "material.roughness = min( material.roughness, 1.0 );",
      "material.specularColor = specularFactor;",
      "material.specularColorBlended = specularFactor;",
      "material.specularF90 = 1.0;"
    ].join("\n");

    const uniforms: Record<string, { value: unknown }> = {
      specular: { value: new Color().setHex(0xffffff) },
      glossiness: { value: 1 },
      specularMap: { value: null as Texture | null },
      glossinessMap: { value: null as Texture | null }
    };

    this._extraUniforms = uniforms;

    this.onBeforeCompile = (shader) => {
      for (const uniformName in uniforms) {
        shader.uniforms[uniformName] = uniforms[uniformName];
      }

      shader.fragmentShader = shader.fragmentShader
        .replace("uniform float roughness;", "uniform vec3 specular;")
        .replace("uniform float metalness;", "uniform float glossiness;")
        .replace("#include <roughnessmap_pars_fragment>", specularMapParsFragmentChunk)
        .replace("#include <metalnessmap_pars_fragment>", glossinessMapParsFragmentChunk)
        .replace("#include <roughnessmap_fragment>", specularMapFragmentChunk)
        .replace("#include <metalnessmap_fragment>", glossinessMapFragmentChunk)
        .replace("#include <lights_physical_fragment>", lightPhysicalFragmentChunk);
    };

    Object.defineProperties(this, {
      specular: {
        get: () => uniforms.specular.value as Color,
        set: (value: Color) => {
          uniforms.specular.value = value;
        }
      },
      specularMap: {
        get: () => uniforms.specularMap.value as Texture | null,
        set: (value: Texture | null) => {
          uniforms.specularMap.value = value;
          this.defines = this.defines ?? {};
          if (value) {
            this.defines.USE_SPECULARMAP = "";
            this.defines.USE_UV = "";
          } else {
            delete this.defines.USE_SPECULARMAP;
          }
        }
      },
      glossiness: {
        get: () => uniforms.glossiness.value as number,
        set: (value: number) => {
          uniforms.glossiness.value = value;
        }
      },
      glossinessMap: {
        get: () => uniforms.glossinessMap.value as Texture | null,
        set: (value: Texture | null) => {
          uniforms.glossinessMap.value = value;
          this.defines = this.defines ?? {};
          if (value) {
            this.defines.USE_GLOSSINESSMAP = "";
            this.defines.USE_UV = "";
          } else {
            delete this.defines.USE_GLOSSINESSMAP;
            delete this.defines.USE_UV;
          }
        }
      }
    });

    const unsafeThis = this as unknown as Partial<Record<string, unknown>>;
    delete unsafeThis.metalness;
    delete unsafeThis.roughness;
    delete unsafeThis.metalnessMap;
    delete unsafeThis.roughnessMap;

    this.setValues(params);
  }

  copy(source: GLTFMeshStandardSGMaterial): this {
    super.copy(source);

    this.specularMap = source.specularMap;
    this.specular.copy(source.specular);
    this.glossinessMap = source.glossinessMap;
    this.glossiness = source.glossiness;
    const unsafeThis = this as unknown as Partial<Record<string, unknown>>;
    delete unsafeThis.metalness;
    delete unsafeThis.roughness;
    delete unsafeThis.metalnessMap;
    delete unsafeThis.roughnessMap;
    return this;
  }
}

class GLTFMaterialsPbrSpecularGlossinessExtension {
  public readonly name = SPECULAR_GLOSSINESS_EXTENSION;
  private parser: GLTFParserLike;

  constructor(parser: GLTFParserLike) {
    this.parser = parser;
  }

  getMaterialType(materialIndex: number): typeof GLTFMeshStandardSGMaterial | null {
    const materialDef = this.parser.json.materials?.[materialIndex];
    if (!materialDef?.extensions?.[SPECULAR_GLOSSINESS_EXTENSION]) {
      return null;
    }
    return GLTFMeshStandardSGMaterial;
  }

  extendMaterialParams(materialIndex: number, materialParams: Record<string, unknown>): Promise<void> {
    const materialDef = this.parser.json.materials?.[materialIndex];
    const extension = materialDef?.extensions?.[SPECULAR_GLOSSINESS_EXTENSION] as GLTFMaterialExtension | undefined;
    if (!extension) {
      return Promise.resolve();
    }

    const params = materialParams as Partial<Record<string, unknown>>;
    delete params.metalness;
    delete params.roughness;
    delete params.metalnessMap;
    delete params.roughnessMap;

    const color = new Color(1, 1, 1);
    let opacity = 1;

    if (Array.isArray(extension.diffuseFactor)) {
      const [r, g, b, a] = extension.diffuseFactor;
      color.setRGB(r ?? 1, g ?? 1, b ?? 1, LinearSRGBColorSpace);
      if (typeof a === "number") {
        opacity = a;
      }
    }

    materialParams.color = color;
    materialParams.opacity = opacity;

    const pending: Array<Promise<unknown>> = [];

    if (extension.diffuseTexture !== undefined) {
      pending.push(this.parser.assignTexture(materialParams, "map", extension.diffuseTexture, SRGBColorSpace));
    } else {
      delete params.map;
    }

    const specularColor = new Color(1, 1, 1);
    if (Array.isArray(extension.specularFactor)) {
      const [r, g, b] = extension.specularFactor;
      specularColor.setRGB(r ?? 1, g ?? 1, b ?? 1, LinearSRGBColorSpace);
    }

    materialParams.specular = specularColor;
    materialParams.glossiness = typeof extension.glossinessFactor === "number" ? extension.glossinessFactor : 1;

    if (extension.specularGlossinessTexture !== undefined) {
      const specGlossTexture = extension.specularGlossinessTexture;
      pending.push(this.parser.assignTexture(materialParams, "specularMap", specGlossTexture, SRGBColorSpace));
      pending.push(this.parser.assignTexture(materialParams, "glossinessMap", specGlossTexture));
    } else {
      delete params.specularMap;
      delete params.glossinessMap;
    }

    return Promise.all(pending).then(() => undefined);
  }
}

export const registerPbrSpecularGlossiness = (loader: GLTFLoader): GLTFLoader => {
  loader.register((parser) => new GLTFMaterialsPbrSpecularGlossinessExtension(parser as GLTFParserLike));
  return loader;
};
