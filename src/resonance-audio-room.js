/* global AFRAME, THREE, AudioContext */
const { ResonanceAudio } = require('resonance-audio')
const { onceWhenLoaded } = require('./utils')

const RESONANCE_MATERIAL = Object.keys(ResonanceAudio.Utils.ROOM_MATERIAL_COEFFICIENTS)

AFRAME.registerComponent('resonance-audio-room', {
  dependencies: ['position', 'rotation'],

  schema: {
    // Room dimensions. The position is the center point of this box.
    width: {type: 'number', default: ResonanceAudio.Utils.DEFAULT_ROOM_DIMENSIONS.width},
    height: {type: 'number', default: ResonanceAudio.Utils.DEFAULT_ROOM_DIMENSIONS.height},
    depth: {type: 'number', default: ResonanceAudio.Utils.DEFAULT_ROOM_DIMENSIONS.depth},

    // Resonance audio parameters.
    ambisonicOrder: {type: 'int', default: ResonanceAudio.Utils.DEFAULT_AMBISONIC_ORDER},
    speedOfSound: {type: 'number', default: ResonanceAudio.Utils.DEFAULT_SPEED_OF_SOUND},

    // Room wall materials.
    left: {default: 'brick-bare', oneOf: RESONANCE_MATERIAL},
    right: {default: 'brick-bare', oneOf: RESONANCE_MATERIAL},
    front: {default: 'brick-bare', oneOf: RESONANCE_MATERIAL},
    back: {default: 'brick-bare', oneOf: RESONANCE_MATERIAL},
    down: {default: 'brick-bare', oneOf: RESONANCE_MATERIAL},
    up: {default: 'brick-bare', oneOf: RESONANCE_MATERIAL},

    // Whether to show a visualization of the room. This shows a wireframe of the box that is considered as the room.
    visualize: {type: 'boolean', default: false}
  },

  init () {
    // Initialize the audio context and connect with Resonance.
    this.audioContext = new AudioContext()
    this.resonanceAudioScene = new ResonanceAudio(this.audioContext)
    this.resonanceAudioScene.output.connect(this.audioContext.destination)

    // Visualization entity of the room.
    this.visualization = null

    // Collection of audio sources.
    this.sources = []
    this.exposeAPI()

    // Set up the room acoustics before the audio sources are set up.
    this.updateRoomAcoustics()

    // Update on entity change.
    this.onEntityChange = this.onEntityChange.bind(this)
    this.el.addEventListener('componentchanged', this.onEntityChange)

    // When the scene has loaded and all world positions are calculated, update the visualization.
    onceWhenLoaded(this.el.sceneEl, () => {
      this.updateVisualization()
    })
  },

  update (oldData) {
    this.el.sceneEl.object3D.updateMatrixWorld(true)
    this.updateRoomAcoustics()
    this.toggleShowVisualization(oldData.visualize, this.data.visualize)
    this.updateVisualization()
  },

  tock () {
    // Calculate camera position relative to room.
    this.resonanceAudioScene.setListenerFromMatrix(
      new THREE.Matrix4().multiplyMatrices(
        new THREE.Matrix4().getInverse(this.el.object3D.matrixWorld),
        this.el.sceneEl.camera.el.object3D.matrixWorld
      )
    )
  },

  remove () {
    [...this.sources].map(source => source.leaveRoom())
    this.toggleShowVisualization(this.data.visualize, false)
    this.el.removeEventListener('componentchanged', this.onEntityChange)
  },

  /**
   * Update room acoustics.
   */
  updateRoomAcoustics () {
    this.resonanceAudioScene.setRoomProperties({
      width: this.data.width,
      height: this.data.height,
      depth: this.data.depth
    }, {
      left: this.data.left,
      right: this.data.right,
      front: this.data.front,
      back: this.data.back,
      down: this.data.down,
      up: this.data.up
    })
    this.resonanceAudioScene.setAmbisonicOrder(this.data.ambisonicOrder)
    this.resonanceAudioScene.setSpeedOfSound(this.data.speedOfSound)
  },

  /**
   * Update the visualization of this audio room according to the properties set.
   * @returns {this}
   */
  updateVisualization () {
    const d = this.data
    if (d.visualize && this.visualization) {
      this.el.sceneEl.object3D.updateMatrixWorld(true)
      const p = new THREE.Vector3()
      const q = new THREE.Quaternion()
      const s = new THREE.Vector3()
      this.el.object3D.matrixWorld.decompose(p, q, s)
      const r = new THREE.Euler().setFromQuaternion(q, 'YXZ')
      const r2d = THREE.Math.radToDeg

      this.visualization.setAttribute('position', p)
      this.visualization.setAttribute('rotation', {x: r2d(r.x), y: r2d(r.y), z: r2d(r.z)})
      this.visualization.setAttribute('width', d.width)
      this.visualization.setAttribute('height', d.height)
      this.visualization.setAttribute('depth', d.depth)
    }
    return this
  },

  /**
   * Toggle showing the visualization.
   * @param {boolean} previous - the previous setting
   * @param {boolean} current - the new setting
   */
  toggleShowVisualization (previous, current) {
    // This is done to the root so it is not affected by the current entity.
    if (!previous && current) {
      this.visualization = document.createElement('a-box')
      this.visualization.audioRoom = this.el
      this.visualization.setAttribute('material', 'wireframe', true)
      this.el.sceneEl.appendChild(this.visualization)
    } else if (previous && !current && this.visualization) {
      this.el.sceneEl.removeChild(this.visualization)
      this.visualization = null
    }
  },

  /**
   * When the entity's position or rotation is changed, update visualization and sources
   * accordingly.
   * @param {Event} evt
   */
  onEntityChange (evt) {
    if (evt.detail.name !== 'position' && evt.detail.name !== 'rotation') { return }

    this.updateVisualization()
    this.sources.forEach(source => source.updateResonancePosition().updateVisualization())
  },

  /**
   * Expose two collections on the element for easy access:
   * - audioSources: the connected resonance-audio-src components.
   * - sounds: the connected HTMLMediaElement and MediaStream objects.
   */
  exposeAPI () {
    Object.defineProperties(this.el, {
      // Array of audio source components.
      audioSources: { enumerable: true, get: () => this.sources },
      // Array of audio sources (HTMLMediaElement and MediaStream objects).
      sounds: { enumerable: true, get: () => this.sources.map(source => source.sound) }
    })
  },

  /**
   * Store audio source.
   * @param {HTMLElement} el
   */
  store (el) {
    // Only consider relevant elements.
    if (!el || !el.components || !('resonance-audio-src' in el.components)) { return }

    this.sources.push(el.components['resonance-audio-src'])
  },

  /**
   * Forget audio source by forgetting its component reference.
   * @param {HTMLElement} el - the audio source
   */
  forget (el) {
    const source = el.components['resonance-audio-src']
    if (!source || !this.sources.includes(source)) { return }

    this.sources.splice(this.sources.indexOf(source), 1)
  }
})

AFRAME.registerPrimitive('a-resonance-audio-room', {
  defaultComponents: {
    'resonance-audio-room': {}
  },
  mappings: {
    width: 'resonance-audio-room.width',
    height: 'resonance-audio-room.height',
    depth: 'resonance-audio-room.depth',
    'ambisonic-order': 'resonance-audio-room.ambisonicOrder',
    'speed-of-sound': 'resonance-audio-room.speedOfSound',
    left: 'resonance-audio-room.left',
    right: 'resonance-audio-room.right',
    front: 'resonance-audio-room.front',
    back: 'resonance-audio-room.back',
    down: 'resonance-audio-room.down',
    up: 'resonance-audio-room.up',
    visualize: 'resonance-audio-room.visualize'
  }
})
