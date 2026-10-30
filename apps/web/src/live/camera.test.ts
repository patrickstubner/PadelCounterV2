import { describe, expect, it, vi } from 'vitest';
import { SCAN_VIDEO_CONSTRAINTS, openScanCamera, preferContinuousFocus, scheduleScanFrame } from './camera';

describe('scan camera', () => {
  it('asks for a large rear frame and falls back when that size is refused', async () => {
    const calls: MediaStreamConstraints[] = [];
    const stream = { getTracks: () => [] } as unknown as MediaStream;
    const getUserMedia = vi.fn(async (constraints: MediaStreamConstraints) => {
      calls.push(constraints);
      if (calls.length === 1) throw new DOMException('overconstrained', 'OverconstrainedError');
      return stream;
    });
    await expect(openScanCamera(getUserMedia)).resolves.toBe(stream);
    expect(calls.map((call) => call.audio)).toEqual([false, false]);
    expect(calls[0]?.video).toEqual(SCAN_VIDEO_CONSTRAINTS[0]);
    expect(calls[1]?.video).toEqual(SCAN_VIDEO_CONSTRAINTS[1]);
  });

  it('requests continuous focus only when the track lists it', async () => {
    const apply = vi.fn(async () => undefined);
    const quiet = {
      getCapabilities: () => ({}),
      applyConstraints: apply,
    } as unknown as MediaStreamTrack;
    await preferContinuousFocus(quiet);
    expect(apply).not.toHaveBeenCalled();

    const focused = {
      getCapabilities: () => ({ focusMode: ['manual', 'continuous'] }),
      applyConstraints: apply,
    } as unknown as MediaStreamTrack;
    await preferContinuousFocus(focused);
    expect(apply).toHaveBeenCalledTimes(1);
    const calls = apply.mock.calls as unknown as ReadonlyArray<readonly [{ advanced?: { focusMode?: string }[] }]>;
    expect(calls[0]?.[0]?.advanced?.[0]?.focusMode).toBe('continuous');

    apply.mockRejectedValueOnce(new Error('refused'));
    await expect(preferContinuousFocus(focused)).resolves.toBeUndefined();
  });

  it('waits for the next video frame when the element can report one', () => {
    let cancelId = 0;
    const video = {
      requestVideoFrameCallback: (callback: () => void) => {
        callback();
        return 4;
      },
      cancelVideoFrameCallback: (id: number) => {
        cancelId = id;
      },
    } as unknown as HTMLVideoElement;
    let ran = false;
    const cancel = scheduleScanFrame(video, () => {
      ran = true;
    });
    expect(ran).toBe(true);
    cancel();
    expect(cancelId).toBe(4);
  });
});
