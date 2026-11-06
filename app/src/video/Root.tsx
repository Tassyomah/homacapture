import { Composition } from 'remotion'
import { Screencast, compositionSize } from './Screencast'
import { keptDuration } from './ranges'
import { defaultConfig, type ScreencastProps } from '../shared/types'

const FPS = 60
const empty: ScreencastProps = {
  assets: { screen: '', mic: null, micClean: null, camera: null, system: null, cursors: {} },
  events: { version: 1, display: { id: 0, scale: 2, pointWidth: 960, pointHeight: 600, width: 1920, height: 1200 }, fps: FPS,
    tLaunch: 0, tEnd: 1, t0Video: 0, t0Mic: null, videoDuration: 1, videoFrames: FPS, cursors: {}, cursorChanges: [],
    moves: [], clicks: [], scrolls: [], micOffset: null, files: { screen: '', mic: null } },
  config: defaultConfig,
}

export const RemotionRoot = () => (
  <Composition id="Screencast" component={Screencast} fps={FPS} defaultProps={empty}
    width={1920} height={1200} durationInFrames={FPS}
    calculateMetadata={({ props }) => ({ ...compositionSize(props), durationInFrames: Math.max(1, Math.ceil(keptDuration(props.events, props.cuts ?? [], props.speeds ?? [], props.inserts ?? []) * FPS)) })} />
)
