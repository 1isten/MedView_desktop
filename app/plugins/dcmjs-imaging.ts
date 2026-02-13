// @ts-nocheck
// https://github.com/PantelisGeorgiadis/dcmjs-imaging/blob/312c046bb311a386dcd6d917b302970d20f9f417/examples/index.html

import dcmjsImaging from 'dcmjs-imaging';

const WebGPUVertexShaderCode = `
  struct VertexOutput {
    @builtin(position) position : vec4<f32>,
    @location(0) texCoord : vec2<f32>,
  };

  @vertex
  fn main_v(@location(0) position : vec2<f32>, @location(1) texCoord : vec2<f32>) -> VertexOutput {
    var output : VertexOutput;
    output.position = vec4<f32>(position, 0.0, 1.0);
    output.texCoord = texCoord;
    return output;
  }
`;
const WebGPUFragmentShaderCode = `
  @group(0) @binding(0) var texSampler: sampler;
  @group(0) @binding(1) var tex: texture_2d<f32>;

  @fragment
  fn main_f(@location(0) texCoord : vec2<f32>) -> @location(0) vec4<f32> {
    return textureSample(tex, texSampler, texCoord);
  }
`;

const WebGLBaseVertexShader = `
  attribute vec2 position;
  varying vec2 texCoords;
  void main() {
    texCoords = (position + 1.0) / 2.0;
    texCoords.y = 1.0 - texCoords.y;
    gl_Position = vec4(position, 0, 1.0);
  }
`;
const WebGLBaseFragmentShader = `
  precision highp float;
  varying vec2 texCoords;
  uniform sampler2D textureSampler;
  void main() {
    vec4 color = texture2D(textureSampler, texCoords);
    gl_FragColor = color;
  }
`;

export default defineNuxtPlugin(async () => {
  const { DicomImage, NativePixelDecoder } = dcmjsImaging;

  let webGPUAdapter: any;
  let webGPUDevice: any;
  let webGPUFormat: any;
  if (import.meta.browser) {
    await NativePixelDecoder.initializeAsync();
    if (navigator.gpu) {
      webGPUAdapter = await navigator.gpu.requestAdapter();
      if (webGPUAdapter) {
        webGPUDevice = await webGPUAdapter.requestDevice();
        if (webGPUDevice) {
          webGPUFormat = navigator.gpu.getPreferredCanvasFormat();
        }
      }
    }
  }
  let webGPUShaderModule: GPUShaderModule | null = null;
  let webGPUBindGroupLayout: GPUBindGroupLayout | null = null;
  let webGPUPipelineLayout: GPUPipelineLayout | null = null;
  let webGPUPipeline: GPURenderPipeline | null = null;
  let webGPUVertexBuffer: GPUBuffer | null = null;
  let webGPUSampler: GPUSampler | null = null;
  let webGPUTexture: GPUTexture | null = null;
  let webGPUBindGroup: GPUBindGroup | null = null;
  let webGPUTextureSize: { width: number; height: number } | null = null;
  let webGPUImageData: ImageData | null = null;
  let sharedWebGPUCanvas: HTMLCanvasElement | null = null;
  let sharedWebGPUContext: GPUCanvasContext | null = null;
  function getSharedWebGPUContext(width: number, height: number) {
    if (!sharedWebGPUCanvas) {
      sharedWebGPUCanvas = document.createElement('canvas');
      sharedWebGPUContext = sharedWebGPUCanvas.getContext('webgpu') as GPUCanvasContext | null;
    }
    if (!sharedWebGPUContext) return null;
    sharedWebGPUCanvas.width = width;
    sharedWebGPUCanvas.height = height;
    return { canvas: sharedWebGPUCanvas, gpu: sharedWebGPUContext };
  }
  function isWebGPUAvailable() {
    if (typeof GPUCanvasContext === 'undefined') {
      return false;
    }
    if (!navigator.gpu) {
      return false;
    }
    if (!webGPUAdapter || !webGPUDevice || !webGPUFormat) {
      return false;
    }
    return getSharedWebGPUContext(1, 1)?.gpu instanceof GPUCanvasContext;
  }

  let webGLProgram: WebGLProgram | null = null;
  let webGLVertexBuffer: WebGLBuffer | null = null;
  let webGLTexture: WebGLTexture | null = null;
  let webGLPositionLocation: number | null = null;
  let webGLTextureSize: { width: number; height: number } | null = null;
  let sharedWebGLCanvas: HTMLCanvasElement | null = null;
  let sharedWebGLContext: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  function getSharedWebGLContext(width: number, height: number) {
    if (!sharedWebGLCanvas) {
      sharedWebGLCanvas = document.createElement('canvas');
      const gl2 = sharedWebGLCanvas.getContext('webgl2');
      if (gl2) {
        sharedWebGLContext = gl2 as WebGL2RenderingContext;
      } else {
        sharedWebGLCanvas = document.createElement('canvas');
        sharedWebGLContext = sharedWebGLCanvas.getContext('webgl') || sharedWebGLCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
      }
    }
    if (!sharedWebGLContext) return null;
    sharedWebGLCanvas.width = width;
    sharedWebGLCanvas.height = height;
    return { canvas: sharedWebGLCanvas, gl: sharedWebGLContext };
  }
  function isWebGLAvailable() {
    if (typeof WebGLRenderingContext === 'undefined') {
      return false;
    }
    const gl = getSharedWebGLContext(1, 1)?.gl;
    if (!gl) {
      return false;
    }
    if (typeof WebGL2RenderingContext !== 'undefined') {
      if (gl instanceof WebGL2RenderingContext) {
        return true;
      }
    }
    return gl instanceof WebGLRenderingContext;
  }

  let sharedCanvas2D: HTMLCanvasElement | null = null;
  let sharedCanvas2DContext: CanvasRenderingContext2D | null = null;
  function getSharedCanvas2DContext(width: number, height: number) {
    if (!sharedCanvas2D) {
      sharedCanvas2D = document.createElement('canvas');
      sharedCanvas2DContext = sharedCanvas2D.getContext('2d');
    }
    if (!sharedCanvas2DContext) return null;
    sharedCanvas2D.width = width;
    sharedCanvas2D.height = height;
    return { canvas: sharedCanvas2D, ctx: sharedCanvas2DContext };
  }

  return {
    provide: {
      dcmjsImaging: {
        DicomImage,
        render: async (arrayBuffer: ArrayBuffer, frame = 0) => {
          const image = new DicomImage(arrayBuffer);
          const outputCanvas = document.createElement('canvas');

          let renderer =
            isWebGPUAvailable() ? 'WebGPU' :
            isWebGLAvailable() ? 'WebGL' :
            'Canvas';

          function renderFrameWebGPU(renderingResult: ReturnType<typeof image.render>, gpu: GPUCanvasContext) {
            const renderedPixels = new Uint8ClampedArray(renderingResult.pixels);
            if (
              !webGPUImageData ||
              webGPUImageData.width !== renderingResult.width ||
              webGPUImageData.height !== renderingResult.height
            ) {
              webGPUImageData = new ImageData(
                new Uint8ClampedArray(renderedPixels),
                renderingResult.width,
                renderingResult.height
              );
            } else {
              webGPUImageData.data.set(renderedPixels);
            }

            gpu.configure({
              device: webGPUDevice,
              format: webGPUFormat,
            });

            if (!webGPUShaderModule) {
              webGPUShaderModule = webGPUDevice.createShaderModule({
                code: WebGPUVertexShaderCode + WebGPUFragmentShaderCode,
              });
            }
            if (!webGPUBindGroupLayout) {
              webGPUBindGroupLayout = webGPUDevice.createBindGroupLayout({
                entries: [
                  { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                  { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
                ],
              });
            }
            if (!webGPUPipelineLayout) {
              webGPUPipelineLayout = webGPUDevice.createPipelineLayout({
                bindGroupLayouts: [webGPUBindGroupLayout],
              });
            }
            if (!webGPUPipeline) {
              webGPUPipeline = webGPUDevice.createRenderPipeline({
                layout: webGPUPipelineLayout,
                vertex: {
                  module: webGPUShaderModule,
                  entryPoint: 'main_v',
                  buffers: [
                    {
                      arrayStride: 16,
                      attributes: [
                        { shaderLocation: 0, offset: 0, format: 'float32x2' },
                        { shaderLocation: 1, offset: 8, format: 'float32x2' },
                      ],
                    },
                  ],
                },
                fragment: {
                  module: webGPUShaderModule,
                  entryPoint: 'main_f',
                  targets: [
                    {
                      format: webGPUFormat,
                    },
                  ],
                },
                primitive: {
                  topology: 'triangle-list',
                },
              });
            }

            if (!webGPUVertexBuffer) {
              // prettier-ignore
              const vertexData = new Float32Array([
                -1, -1, 0, 0,
                1, -1, 1, 0,
                1, 1, 1, 1,
                1, 1, 1, 1,
                -1, 1, 0, 1,
                -1, -1, 0, 0
              ]);
              webGPUVertexBuffer = webGPUDevice.createBuffer({
                size: vertexData.byteLength,
                usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
              });
              webGPUDevice.queue.writeBuffer(webGPUVertexBuffer, 0, vertexData);
            }

            const sizeChanged =
              !webGPUTextureSize ||
              webGPUTextureSize.width !== renderingResult.width ||
              webGPUTextureSize.height !== renderingResult.height;
            if (sizeChanged) {
              webGPUTexture?.destroy();
              webGPUTexture = webGPUDevice.createTexture({
                size: [renderingResult.width, renderingResult.height, 1],
                format: 'rgba8unorm',
                usage:
                  GPUTextureUsage.TEXTURE_BINDING |
                  GPUTextureUsage.COPY_DST |
                  GPUTextureUsage.RENDER_ATTACHMENT,
              });
              webGPUTextureSize = {
                width: renderingResult.width,
                height: renderingResult.height,
              };
              webGPUBindGroup = null;
            }

            webGPUDevice.queue.copyExternalImageToTexture(
              { source: webGPUImageData!, flipY: true },
              { texture: webGPUTexture! },
              { width: renderingResult.width, height: renderingResult.height }
            );

            if (!webGPUSampler) {
              webGPUSampler = webGPUDevice.createSampler({
                magFilter: 'linear',
                minFilter: 'linear',
              });
            }
            if (!webGPUBindGroup) {
              webGPUBindGroup = webGPUDevice.createBindGroup({
                layout: webGPUBindGroupLayout!,
                entries: [
                  { binding: 0, resource: webGPUSampler },
                  { binding: 1, resource: webGPUTexture!.createView() },
                ],
              });
            }

            const textureView = gpu.getCurrentTexture().createView();
            const renderPassDescriptor = {
              colorAttachments: [
                {
                  clearValue: { a: 1, b: 0, g: 0, r: 0 },
                  loadOp: 'clear',
                  storeOp: 'store',
                  view: textureView,
                },
              ],
            };

            const commandEncoder = webGPUDevice.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
            passEncoder.setPipeline(webGPUPipeline!);
            passEncoder.setVertexBuffer(0, webGPUVertexBuffer!);
            passEncoder.setBindGroup(0, webGPUBindGroup!);
            passEncoder.draw(6);
            passEncoder.end();

            webGPUDevice.queue.submit([commandEncoder.finish()]);
          }
          function renderFrameWebGL(renderingResult: ReturnType<typeof image.render>, gl: WebGLRenderingContext | WebGL2RenderingContext) {
            const renderedPixels = new Uint8Array(renderingResult.pixels);

            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.clearColor(1.0, 1.0, 1.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

            if (!webGLProgram) {
              const vertexShader = gl.createShader(gl.VERTEX_SHADER)!;
              gl.shaderSource(vertexShader, WebGLBaseVertexShader);
              gl.compileShader(vertexShader);
              if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                throw new Error('Error compiling vertex shader', gl.getShaderInfoLog(vertexShader));
              }

              const fragmentShader = gl.createShader(gl.FRAGMENT_SHADER)!;
              gl.shaderSource(fragmentShader, WebGLBaseFragmentShader);
              gl.compileShader(fragmentShader);
              if (!gl.getShaderParameter(vertexShader, gl.COMPILE_STATUS)) {
                throw new Error('Error compiling fragment shader', gl.getShaderInfoLog(fragmentShader));
              }

              webGLProgram = gl.createProgram();
              gl.attachShader(webGLProgram, vertexShader);
              gl.attachShader(webGLProgram, fragmentShader);
              gl.linkProgram(webGLProgram);
              if (!gl.getProgramParameter(webGLProgram, gl.LINK_STATUS)) {
                throw new Error('Error linking program', gl.getProgramInfoLog(webGLProgram));
              }
              gl.validateProgram(webGLProgram);
              if (!gl.getProgramParameter(webGLProgram, gl.VALIDATE_STATUS)) {
                throw new Error('Error validating program', gl.getProgramInfoLog(webGLProgram));
              }
              gl.deleteShader(vertexShader);
              gl.deleteShader(fragmentShader);
            }

            gl.useProgram(webGLProgram);

            if (!webGLVertexBuffer) {
              // prettier-ignore
              const vertices = new Float32Array([
                -1, -1, 1,
                -1, -1, 1,
                1, -1, -1,
                1, 1, 1
              ]);
              webGLVertexBuffer = gl.createBuffer();
              gl.bindBuffer(gl.ARRAY_BUFFER, webGLVertexBuffer);
              gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
              webGLPositionLocation = gl.getAttribLocation(webGLProgram, 'position');
            } else {
              gl.bindBuffer(gl.ARRAY_BUFFER, webGLVertexBuffer);
            }

            gl.vertexAttribPointer(webGLPositionLocation!, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(webGLPositionLocation!);

            if (!webGLTexture) {
              webGLTexture = gl.createTexture();
            }
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, webGLTexture);
            const glSizeChanged =
              !webGLTextureSize ||
              webGLTextureSize.width !== renderingResult.width ||
              webGLTextureSize.height !== renderingResult.height;
            if (glSizeChanged) {
              gl.texImage2D(
                gl.TEXTURE_2D,
                0,
                gl.RGBA,
                renderingResult.width,
                renderingResult.height,
                0,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                renderedPixels
              );
              webGLTextureSize = {
                width: renderingResult.width,
                height: renderingResult.height,
              };
            } else {
              gl.texSubImage2D(
                gl.TEXTURE_2D,
                0,
                0,
                0,
                renderingResult.width,
                renderingResult.height,
                gl.RGBA,
                gl.UNSIGNED_BYTE,
                renderedPixels
              );
            }
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

            gl.drawArrays(gl.TRIANGLES, 0, 6);
          }
          function renderFrameCanvas(renderingResult: ReturnType<typeof image.render>, ctx: CanvasRenderingContext2D) {
            const renderedPixels = new Uint8Array(renderingResult.pixels);

            ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
            const imageData = ctx.createImageData(renderingResult.width, renderingResult.height);
            imageData.data.set(renderedPixels);
            ctx.putImageData(imageData, 0, 0);
          }

          try {
            const renderingResult = image.render({ frame });
            outputCanvas.width = renderingResult.width;
            outputCanvas.height = renderingResult.height;
            if (renderer === 'WebGPU') {
              const sharedCtx = getSharedWebGPUContext(renderingResult.width, renderingResult.height);
              if (!sharedCtx) {
                throw new Error('WebGPU context unavailable');
              }
              const { canvas: sharedCanvas, gpu } = sharedCtx;
              renderFrameWebGPU(renderingResult, gpu);
              const ctx = outputCanvas.getContext('2d')!;
              ctx.drawImage(sharedCanvas, 0, 0);
            } else if (renderer === 'WebGL') {
              const sharedCtx = getSharedWebGLContext(renderingResult.width, renderingResult.height);
              if (!sharedCtx) {
                throw new Error('WebGL context unavailable');
              }
              const { canvas: sharedCanvas, gl } = sharedCtx;
              renderFrameWebGL(renderingResult, gl);
              const ctx = outputCanvas.getContext('2d')!;
              ctx.drawImage(sharedCanvas, 0, 0);
              if (typeof WebGL2RenderingContext !== 'undefined') {
                if (gl instanceof WebGL2RenderingContext) {
                  renderer = 'WebGL2';
                }
              }
            } else {
              const sharedCtx = getSharedCanvas2DContext(renderingResult.width, renderingResult.height);
              if (!sharedCtx) {
                throw new Error('Canvas 2D context unavailable');
              }
              const { canvas: sharedCanvas, ctx: ctx2d } = sharedCtx;
              renderFrameCanvas(renderingResult, ctx2d);
              const ctx = outputCanvas.getContext('2d')!;
              ctx.drawImage(sharedCanvas, 0, 0);
            }
          } catch (error) {
            console.error(error);
            return null;
          }

          return { canvas: outputCanvas, renderer };
        },
      },
    },
  };
});
