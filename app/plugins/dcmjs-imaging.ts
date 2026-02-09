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

  let webGpuAdapter: any;
  let webGpuDevice: any;
  let webGpuFormat: any;

  if (import.meta.browser) {
    await NativePixelDecoder.initializeAsync();
    if (navigator.gpu) {
      webGpuAdapter = await navigator.gpu.requestAdapter();
      webGpuDevice = await webGpuAdapter.requestDevice();
      webGpuFormat = navigator.gpu.getPreferredCanvasFormat();
    }
  }

  return {
    provide: {
      dcmjsImaging: {
        DicomImage,
        render: async (arrayBuffer: ArrayBuffer, frame = 0) => {
          const image = new DicomImage(arrayBuffer);
          const canvas = document.createElement('canvas');

          function isWebGLAvailable() {
            const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
            return gl instanceof WebGLRenderingContext;
          }
          function isWebGpuAvailable() {
            if (!navigator.gpu) {
              return false;
            }
            if (!webGpuAdapter || !webGpuDevice || !webGpuFormat) {
              return false;
            }
            const gpu = canvas.getContext('webgpu');
            return gpu instanceof GPUCanvasContext;
          }

          let renderer = 'Canvas';
          if (isWebGLAvailable()) {
            renderer = 'WebGL';
          } else if (isWebGpuAvailable()) {
            renderer = 'WebGPU';
          }

          function renderFrameWebGPU(renderingResult: ReturnType<typeof image.render>, canvasElement: HTMLCanvasElement) {
            const renderedPixels = new Uint8ClampedArray(renderingResult.pixels);
            const imageData = new ImageData(
              renderedPixels,
              renderingResult.width,
              renderingResult.height
            );

            const context = canvasElement.getContext('webgpu')!;
            context.configure({
              device: webGpuDevice,
              format: webGpuFormat,
            });

            const shaderModule = webGpuDevice.createShaderModule({
              code: WebGPUVertexShaderCode + WebGPUFragmentShaderCode,
            });
            const bindGroupLayout = webGpuDevice.createBindGroupLayout({
              entries: [
                { binding: 0, visibility: GPUShaderStage.FRAGMENT, sampler: {} },
                { binding: 1, visibility: GPUShaderStage.FRAGMENT, texture: {} },
              ],
            });
            const pipelineLayout = webGpuDevice.createPipelineLayout({
              bindGroupLayouts: [bindGroupLayout],
            });
            const pipeline = webGpuDevice.createRenderPipeline({
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
                    format: webGpuFormat,
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
            const vertexBuffer = webGpuDevice.createBuffer({
              size: vertexData.byteLength,
              usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
            });
            webGpuDevice.queue.writeBuffer(vertexBuffer, 0, vertexData);

            const texture = webGpuDevice.createTexture({
              size: [renderingResult.width, renderingResult.height, 1],
              format: 'rgba8unorm',
              usage:
                GPUTextureUsage.TEXTURE_BINDING |
                GPUTextureUsage.COPY_DST |
                GPUTextureUsage.RENDER_ATTACHMENT,
            });
            webGpuDevice.queue.copyExternalImageToTexture(
              { source: imageData, flipY: true },
              { texture },
              { width: renderingResult.width, height: renderingResult.height }
            );

            const sampler = webGpuDevice.createSampler({
              magFilter: 'linear',
              minFilter: 'linear',
            });
            const bindGroup = webGpuDevice.createBindGroup({
              layout: bindGroupLayout,
              entries: [
                { binding: 0, resource: sampler },
                { binding: 1, resource: texture.createView() },
              ],
            });

            const textureView = context.getCurrentTexture().createView();
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

            const commandEncoder = webGpuDevice.createCommandEncoder();
            const passEncoder = commandEncoder.beginRenderPass(renderPassDescriptor);
            passEncoder.setPipeline(pipeline);
            passEncoder.setVertexBuffer(0, vertexBuffer);
            passEncoder.setBindGroup(0, bindGroup);
            passEncoder.draw(6);
            passEncoder.end();

            webGpuDevice.queue.submit([commandEncoder.finish()]);
          }
          function renderFrameWebGL(renderingResult: ReturnType<typeof image.render>, canvasElement: HTMLCanvasElement) {
            const renderedPixels = new Uint8Array(renderingResult.pixels);

            const gl = canvasElement.getContext('webgl')!;
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
          }
          function renderFrameCanvas(renderingResult: ReturnType<typeof image.render>, canvasElement: HTMLCanvasElement) {
            const renderedPixels = new Uint8Array(renderingResult.pixels);

            const ctx = canvasElement.getContext('2d')!;
            // ctx.clearRect(0, 0, canvasElement.width, canvasElement.height);
            const imageData = ctx.createImageData(renderingResult.width, renderingResult.height);
            const canvasPixels = imageData.data;
            for (let i = 0; i < 4 * renderingResult.width * renderingResult.height; i++) {
              canvasPixels[i] = renderedPixels[i] as number;
            }
            ctx.putImageData(imageData, 0, 0);
          }

          try {
            const renderingResult = image.render({ frame });
            canvas.width = renderingResult.width;
            canvas.height = renderingResult.height;
            if (renderer === 'WebGPU') {
              renderFrameWebGPU(renderingResult, canvas);
            } else if (renderer === 'WebGL') {
              renderFrameWebGL(renderingResult, canvas);
            } else {
              renderFrameCanvas(renderingResult, canvas);
            }
          } catch (error) {
            console.error(error);
            return null;
          }

          return { canvas, renderer };
        },
      },
    },
  };
});
