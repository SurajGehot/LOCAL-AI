
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import { SpaceEngine } from "./SpaceEngine";
import "./SpaceView.css";

interface SpaceViewProps {
  onReady: () => void;
}

export interface SpaceViewHandle {
  prepare: () => Promise<void>;
  show: () => void;
  hide: () => void;
  newUniverse: () => void;
  isPrepared: () => boolean;
}

export const SpaceView =
  forwardRef<SpaceViewHandle, SpaceViewProps>(
    ({ onReady }, ref) => {
      const containerRef =
        useRef<HTMLDivElement>(null);

      const engineRef =
        useRef<SpaceEngine | null>(null);

      const preparePromiseRef =
        useRef<Promise<void> | null>(null);

      const mountedRef = useRef(false);
      const lifecycleRef = useRef(0);

      const onReadyRef = useRef(onReady);

      const prepare = (): Promise<void> => {
        if (engineRef.current) {
          return Promise.resolve();
        }

        if (preparePromiseRef.current) {
          return preparePromiseRef.current;
        }

        const container = containerRef.current;

        if (!container || !mountedRef.current) {
          return Promise.reject(
            new Error("SpaceView is not mounted.")
          );
        }

        const engine = new SpaceEngine(container);
        const lifecycle = lifecycleRef.current;
        let creationStarted = false;

        const preparation = Promise.resolve()
          .then(() => {
            if (
              !mountedRef.current ||
              lifecycleRef.current !== lifecycle
            ) {
              throw new Error(
                "SpaceView was unmounted during preparation."
              );
            }

            creationStarted = true;
            engine.create();

            engineRef.current = engine;
          })
          .catch((error: unknown) => {
            if (creationStarted) {
              try {
                engine.destroy();
              } catch (cleanupError) {
                console.error(
                  "Failed to clean up SpaceEngine:",
                  cleanupError
                );
              }
            }

            if (engineRef.current === engine) {
              engineRef.current = null;
            }

            throw error;
          })
          .finally(() => {
            if (
              preparePromiseRef.current === preparation
            ) {
              preparePromiseRef.current = null;
            }
          });

        preparePromiseRef.current = preparation;

        return preparation;
      };

      useEffect(() => {
        mountedRef.current = true;
        const lifecycle = ++lifecycleRef.current;

        void prepare()
          .then(() => {
            if (
              mountedRef.current &&
              lifecycleRef.current === lifecycle
            ) {
              onReadyRef.current();
            }
          })
          .catch((error: unknown) => {
            if (
              mountedRef.current &&
              lifecycleRef.current === lifecycle
            ) {
              console.error(
                "Space engine preparation failed:",
                error
              );
            }
          });

        return () => {
          mountedRef.current = false;
          lifecycleRef.current += 1;

          const engine = engineRef.current;
          engineRef.current = null;

          if (engine) {
            engine.destroy();
          }

          preparePromiseRef.current = null;
        };
      }, []);

      useImperativeHandle(
        ref,
        () => ({
          prepare,

          show() {
            engineRef.current?.setVisible(true);
          },

          hide() {
            engineRef.current?.setVisible(false);
          },

          newUniverse() {
            engineRef.current?.newUniverse();
          },

          isPrepared() {
            return engineRef.current !== null;
          },
        }),
        []
      );

      return (
        <div
          ref={containerRef}
          className="space-view"
        />
      );
    }
  );

SpaceView.displayName = "SpaceView";
