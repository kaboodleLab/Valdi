package com.snap.valdi.three_native

import android.content.Context
import android.graphics.PixelFormat
import android.opengl.GLES30
import android.opengl.GLSurfaceView
import androidx.annotation.Keep
import com.snap.valdi.attributes.AttributesBinder
import com.snap.valdi.attributes.AttributesBindingContext
import com.snap.valdi.attributes.RegisterAttributesBinder
import java.nio.ByteBuffer
import java.nio.ByteOrder
import javax.microedition.khronos.egl.EGLConfig
import javax.microedition.khronos.opengles.GL10

/** A GPU surface owned by Valdi's custom-view lifecycle. */
@Keep
class ThreeSurfaceView(context: Context) : GLSurfaceView(context) {
    private val sceneRenderer = TriangleRenderer()
    private var active = false

    init {
        setEGLContextClientVersion(3)
        setEGLConfigChooser(8, 8, 8, 8, 24, 0)
        holder.setFormat(PixelFormat.OPAQUE)
        setRenderer(sceneRenderer)
        renderMode = RENDERMODE_WHEN_DIRTY
    }

    fun submitMesh(bytes: ByteArray) {
        sceneRenderer.submitMesh(bytes)
        requestRender()
    }

    fun submitTransform(bytes: ByteArray) {
        if (bytes.size != 128) return
        sceneRenderer.submitTransform(bytes)
        requestRender()
    }

    private fun updateLifecycle() {
        val shouldRun = isAttachedToWindow && windowVisibility == VISIBLE && hasWindowFocus()
        if (shouldRun == active) return
        active = shouldRun
        if (active) onResume() else onPause()
    }

    override fun onAttachedToWindow() {
        super.onAttachedToWindow()
        updateLifecycle()
    }

    override fun onWindowVisibilityChanged(visibility: Int) {
        super.onWindowVisibilityChanged(visibility)
        updateLifecycle()
    }

    override fun onWindowFocusChanged(hasWindowFocus: Boolean) {
        super.onWindowFocusChanged(hasWindowFocus)
        updateLifecycle()
    }

    override fun onDetachedFromWindow() {
        if (active) {
            queueEvent { sceneRenderer.dispose() }
            active = false
            onPause()
        }
        sceneRenderer.clearRetained()
        super.onDetachedFromWindow()
    }

    private class TriangleRenderer : GLSurfaceView.Renderer {
        private val lock = Any()
        private var pendingMesh: ByteArray? = null
        private var pendingTransform: ByteArray? = null
        private var retainedMesh: ByteArray? = null
        private var retainedTransform: ByteArray? = null
        private var program = 0
        private var vertexBuffer = 0
        private var vertexArray = 0
        private var vertexCount = 0
        private val mvp = FloatArray(16)
        private val model = FloatArray(16)

        fun submitMesh(bytes: ByteArray) = synchronized(lock) { pendingMesh = bytes }
        fun submitTransform(bytes: ByteArray) = synchronized(lock) { pendingTransform = bytes }
        fun clearRetained() = synchronized(lock) {
            pendingMesh = null
            pendingTransform = null
            retainedMesh = null
            retainedTransform = null
        }

        override fun onSurfaceCreated(gl: GL10?, config: EGLConfig?) {
            // Handles from the old EGL context cannot be reused after resume.
            program = linkProgram(VERTEX_SHADER, FRAGMENT_SHADER)
            val names = IntArray(1)
            GLES30.glGenVertexArrays(1, names, 0)
            vertexArray = names[0]
            GLES30.glGenBuffers(1, names, 0)
            vertexBuffer = names[0]
            GLES30.glEnable(GLES30.GL_DEPTH_TEST)
            GLES30.glClearColor(0.063f, 0.094f, 0.153f, 1f)
            synchronized(lock) {
                if (pendingMesh == null) pendingMesh = retainedMesh
                if (pendingTransform == null) pendingTransform = retainedTransform
            }
        }

        override fun onSurfaceChanged(gl: GL10?, width: Int, height: Int) {
            GLES30.glViewport(0, 0, width, height)
        }

        override fun onDrawFrame(gl: GL10?) {
            val mesh: ByteArray?
            val transform: ByteArray?
            synchronized(lock) {
                mesh = pendingMesh
                transform = pendingTransform
                pendingMesh = null
                pendingTransform = null
            }
            if (mesh != null) {
                retainedMesh = mesh
                vertexCount = mesh.size / (6 * 4)
                val data = ByteBuffer.allocateDirect(mesh.size).order(ByteOrder.LITTLE_ENDIAN)
                data.put(mesh).position(0)
                GLES30.glBindVertexArray(vertexArray)
                GLES30.glBindBuffer(GLES30.GL_ARRAY_BUFFER, vertexBuffer)
                GLES30.glBufferData(GLES30.GL_ARRAY_BUFFER, mesh.size, data, GLES30.GL_STATIC_DRAW)
                GLES30.glEnableVertexAttribArray(0)
                GLES30.glVertexAttribPointer(0, 3, GLES30.GL_FLOAT, false, 24, 0)
                GLES30.glEnableVertexAttribArray(1)
                GLES30.glVertexAttribPointer(1, 3, GLES30.GL_FLOAT, false, 24, 12)
            }
            if (transform != null) {
                retainedTransform = transform
                val data = ByteBuffer.wrap(transform).order(ByteOrder.LITTLE_ENDIAN).asFloatBuffer()
                data.get(mvp)
                data.get(model)
            }
            GLES30.glClear(GLES30.GL_COLOR_BUFFER_BIT or GLES30.GL_DEPTH_BUFFER_BIT)
            if (vertexCount == 0 || program == 0) return
            GLES30.glUseProgram(program)
            GLES30.glUniformMatrix4fv(GLES30.glGetUniformLocation(program, "uMvp"), 1, false, mvp, 0)
            GLES30.glUniformMatrix4fv(GLES30.glGetUniformLocation(program, "uModel"), 1, false, model, 0)
            GLES30.glBindVertexArray(vertexArray)
            GLES30.glDrawArrays(GLES30.GL_TRIANGLES, 0, vertexCount)
        }

        fun dispose() {
            if (vertexBuffer != 0) GLES30.glDeleteBuffers(1, intArrayOf(vertexBuffer), 0)
            if (vertexArray != 0) GLES30.glDeleteVertexArrays(1, intArrayOf(vertexArray), 0)
            if (program != 0) GLES30.glDeleteProgram(program)
            vertexBuffer = 0
            vertexArray = 0
            program = 0
            vertexCount = 0
            retainedMesh = null
            retainedTransform = null
        }

        private fun compileShader(type: Int, source: String): Int {
            val shader = GLES30.glCreateShader(type)
            GLES30.glShaderSource(shader, source)
            GLES30.glCompileShader(shader)
            val result = IntArray(1)
            GLES30.glGetShaderiv(shader, GLES30.GL_COMPILE_STATUS, result, 0)
            if (result[0] == 0) {
                val message = GLES30.glGetShaderInfoLog(shader)
                GLES30.glDeleteShader(shader)
                throw IllegalStateException("Three native shader failed: $message")
            }
            return shader
        }

        private fun linkProgram(vertexSource: String, fragmentSource: String): Int {
            val vertex = compileShader(GLES30.GL_VERTEX_SHADER, vertexSource)
            val fragment = compileShader(GLES30.GL_FRAGMENT_SHADER, fragmentSource)
            val result = GLES30.glCreateProgram()
            GLES30.glAttachShader(result, vertex)
            GLES30.glAttachShader(result, fragment)
            GLES30.glLinkProgram(result)
            GLES30.glDeleteShader(vertex)
            GLES30.glDeleteShader(fragment)
            val status = IntArray(1)
            GLES30.glGetProgramiv(result, GLES30.GL_LINK_STATUS, status, 0)
            if (status[0] == 0) {
                val message = GLES30.glGetProgramInfoLog(result)
                GLES30.glDeleteProgram(result)
                throw IllegalStateException("Three native program failed: $message")
            }
            return result
        }

        companion object {
            private const val VERTEX_SHADER = """#version 300 es
                layout(location = 0) in vec3 aPosition;
                layout(location = 1) in vec3 aNormal;
                uniform mat4 uMvp;
                uniform mat4 uModel;
                out float vLight;
                void main() {
                    vec3 normal = normalize(mat3(uModel) * aNormal);
                    vLight = 0.35 + 0.65 * abs(dot(normal, normalize(vec3(-0.3, 0.6, 1.0))));
                    gl_Position = uMvp * vec4(aPosition, 1.0);
                }
            """
            private const val FRAGMENT_SHADER = """#version 300 es
                precision mediump float;
                in float vLight;
                out vec4 color;
                void main() {
                    color = vec4(vec3(0.37, 0.68, 0.96) * vLight, 1.0);
                }
            """
        }
    }
}

@RegisterAttributesBinder
@Keep
class ThreeSurfaceViewAttributesBinder(@Suppress("UNUSED_PARAMETER") context: Context) : AttributesBinder<ThreeSurfaceView> {
    override val viewClass: Class<ThreeSurfaceView> get() = ThreeSurfaceView::class.java

    override fun bindAttributes(attributesBindingContext: AttributesBindingContext<ThreeSurfaceView>) {
        attributesBindingContext.bindUntypedAttribute("meshBytes", false,
            { view, value -> view.submitMesh(value as? ByteArray ?: ByteArray(0)) },
            { view -> view.submitMesh(ByteArray(0)) })
        attributesBindingContext.bindUntypedAttribute("transformBytes", false,
            { view, value -> if (value is ByteArray) view.submitTransform(value) },
            { _ -> })
    }
}
