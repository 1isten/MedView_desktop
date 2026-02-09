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
      webGPUDevice = await webGPUAdapter.requestDevice();
      webGPUFormat = navigator.gpu.getPreferredCanvasFormat();
    }
  }
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
    if (!navigator.gpu) {
      return false;
    }
    if (!webGPUAdapter || !webGPUDevice || !webGPUFormat) {
      return false;
    }
    return getSharedWebGPUContext(1, 1)?.gpu instanceof GPUCanvasContext;
  }

  let sharedWebGLCanvas: HTMLCanvasElement | null = null;
  let sharedWebGLContext: WebGLRenderingContext | null = null;
  function getSharedWebGLContext(width: number, height: number) {
    if (!sharedWebGLCanvas) {
      sharedWebGLCanvas = document.createElement('canvas');
      sharedWebGLContext = sharedWebGLCanvas.getContext('webgl') || sharedWebGLCanvas.getContext('experimental-webgl') as WebGLRenderingContext | null;
    }
    if (!sharedWebGLContext) return null;
    sharedWebGLCanvas.width = width;
    sharedWebGLCanvas.height = height;
    return { canvas: sharedWebGLCanvas, gl: sharedWebGLContext };
  }
  function isWebGLAvailable() {
    return getSharedWebGLContext(1, 1)?.gl instanceof WebGLRenderingContext;
  }

  return {
    provide: {
      dcmjsImaging: {
        DicomImage,
        render: async (arrayBuffer: ArrayBuffer, frame = 0) => {
          const image = new DicomImage(arrayBuffer);
          const outputCanvas = document.createElement('canvas');

          const renderer =
            isWebGPUAvailable() ? 'WebGPU' :
            isWebGLAvailable() ? 'WebGL' :
            'Canvas';

          function renderFrameWebGPU(renderingResult: ReturnType<typeof image.render>, gpu: GPUCanvasContext) {
            const renderedPixels = new Uint8ClampedArray(renderingResult.pixels);
            const imageData = new ImageData(
              renderedPixels,
              renderingResult.width,
              renderingResult.height
            );

            gpu.configure({
              device: webGPUDevice,
              format: webGPUFormat,
            });

            const shaderModule = webGPUDevice.createShaderModule({
              code: WebGPUVertexShaderCode + WebGPUFragmentShaderCode,
            });
            const bindGroupLayout = webGPUDevice.createBindGroupLayout({
              entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
              ],
            });
            const pipelineLayout = webGPUDevice.createPipelineLayout({
              bindGroupLayouts: [bindGroupLayout],
            });
            const pipeline = webGPUDevice.createRenderPipeline({
              layout: pipelineLayout,
              vertex: {
                module: shaderModule,
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
                module: shaderModule,
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

            // prettier-ignore
            const vertexData = new Float32Array([
              -1, -1, 0, 0,
              1, -1, 1, 0,
              1, 1, 1, 1,
              1, 1, 1, 1,
              -1, 1, 0, 1,
              -1, -1, 0, 0
            ]);
            const vertexBuffer = webGPUDevice.createBuffer({
              size: vertexData.byteLength,
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            webGPUDevice.queue.writeBuffer(vertexBuffer, 0, vertexData);

            const texture = webGPUDevice.createTexture({
              size: [renderingResult.width, renderingResult.height, 1],
              format: 'rgba8unorm',
              usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
            });
            webGPUDevice.queue.copyExternalImageToTexture(
              { source: imageData, flipY: true },
              { texture },
              { width: renderingResult.width, height: renderingResult.height }
            );

            const sampler = webGPUDevice.createSampler({
              magFilter: 'linear',
              minFilter: 'linear',
            });
            const bindGroup = webGPUDevice.createBindGroup({
              layout: bindGroupLayout,
              entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
              ],
            });

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
            passEncoder.setPipeline(pipeline);
            passEncoder.setVertexBuffer(0, vertexBuffer);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(6);
            passEncoder.end();

            webGPUDevice.queue.submit([commandEncoder.finish()]);
          }
          function renderFrameWebGL(renderingResult: ReturnType<typeof image.render>, gl: WebGLRenderingContext) {
            const renderedPixels = new Uint8Array(renderingResult.pixels);

            gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
            gl.clearColor(1.0, 1.0, 1.0, 1.0);
            gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

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

            const program = gl.createProgram();
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
              throw new Error('Error linking program', gl.getProgramInfoLog(program));
            }
            gl.validateProgram(program);
            if (!gl.getProgramParameter(program, gl.VALIDATE_STATUS)) {
              throw new Error('Error validating program', gl.getProgramInfoLog(program));
            }
            gl.useProgram(program);
            gl.deleteShader(vertexShader);
            gl.deleteShader(fragmentShader);

            // prettier-ignore
            const vertices = new Float32Array([
              -1, -1, 1,
              -1, -1, 1,
              1, -1, -1,
              1, 1, 1
            ]);
            const vertexBuffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
            gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);

            const positionLocation = gl.getAttribLocation(program, 'position');
            gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);
            gl.enableVertexAttribArray(positionLocation);

            const texture = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_2D, texture);
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
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
            gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);

            gl.drawArrays(gl.TRIANGLES, 0, 6);

            // Clean up WebGL resources to avoid memory leaks
            gl.deleteTexture(texture);
            gl.deleteBuffer(vertexBuffer);
            gl.deleteProgram(program);
          }
          function renderFrameCanvas(renderingResult: ReturnType<typeof image.render>, canvasElement: HTMLCanvasElement) {
            const renderedPixels = new Uint8Array(renderingResult.pixels);

            const ctx = canvasElement.getContext('2d')!;
            ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            const imageData = ctx.createImageData(renderingResult.width, renderingResult.height);
            const canvasPixels = imageData.data;
            for (let i = 0; i < 4 * renderingResult.width * renderingResult.height; i++) {
              canvasPixels[i] = renderedPixels[i] as number;
            }
            ctx.putImageData(imageData, 0, 0);
          }

          try {
            const renderingResult = image.render({ frame });
            outputCanvas.width = renderingResult.width;
            outputCanvas.height = renderingResult.height;
            if (renderer === 'WebGPU') {
              const { canvas: sharedCanvas, gpu } = getSharedWebGPUContext(renderingResult.width, renderingResult.height)!;
              renderFrameWebGPU(renderingResult, gpu);
              const ctx = outputCanvas.getContext('2d')!;
              ctx.drawImage(sharedCanvas, 0, 0);
            } else if (renderer === 'WebGL') {
              const { canvas: sharedCanvas, gl } = getSharedWebGLContext(renderingResult.width, renderingResult.height)!;
              renderFrameWebGL(renderingResult, gl);
              const ctx = outputCanvas.getContext('2d')!;
              ctx.drawImage(sharedCanvas, 0, 0);
            } else {
              renderFrameCanvas(renderingResult, outputCanvas);
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
