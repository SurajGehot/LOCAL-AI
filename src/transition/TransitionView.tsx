import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
} from "react";

import {
  TransitionController,
} from "./TransitionController";

import type {
  TransitionPhase,
} from "./TransitionController";

import {
  SpaceView,
} from "../space/SpaceView";

import type {
  SpaceViewHandle,
} from "../space/SpaceView";

import "./TransitionController.css";

export interface TransitionViewHandle {
  startDeparture: () => void;
  startReturn: () => void;
  stop: () => void;
  getPhase: () => TransitionPhase;
}

interface TransitionViewProps {
  dashboardElement: HTMLElement | null;
  onPhaseChange: (phase: TransitionPhase) => void;
}

export const TransitionView =
  forwardRef<
    TransitionViewHandle,
    TransitionViewProps
  >(
    (
      {
        dashboardElement,
        onPhaseChange,
      },
      ref
    ) => {
      const controllerRef =
        useRef<TransitionController | null>(null);

      const spaceRef =
        useRef<SpaceViewHandle>(null);

      const handleSpaceReady = useCallback(() => {
        const controller = controllerRef.current;
        const space = spaceRef.current;

        if (!controller || !space) {
          return;
        }

        const phase = controller.getPhase();

        if (phase !== "DEPARTURE" && phase !== "SPACE") {
          return;
        }

        void space.prepare()
          .then(() => {
            const currentPhase =
              controllerRef.current?.getPhase();

            if (
              currentPhase === "DEPARTURE" ||
              currentPhase === "SPACE"
            ) {
              spaceRef.current?.show();
            }
          })
          .catch((error: unknown) => {
            console.error(
              "Space preparation failed:",
              error
            );
          });
      }, []);

      useEffect(() => {
        if (!dashboardElement) {
          return;
        }

        const controller =
          new TransitionController(dashboardElement);

        controllerRef.current = controller;

        const unsubscribe = controller.subscribe((phase) => {
          onPhaseChange(phase);

          if (phase === "DEPARTURE") {
            const space = spaceRef.current;

            if (space) {
              const wasPrepared = space.isPrepared();

              void space.prepare()
                .then(() => {
                  if (wasPrepared) {
                    spaceRef.current?.newUniverse();
                  }

                  const currentPhase =
                    controllerRef.current?.getPhase();

                  if (
                    currentPhase === "DEPARTURE" ||
                    currentPhase === "SPACE"
                  ) {
                    spaceRef.current?.show();
                  }
                })
                .catch((error: unknown) => {
                  console.error(
                    "Space preparation failed:",
                    error
                  );
                });
            }
          }

          if (phase === "SPACE") {
            const space = spaceRef.current;

            if (space) {
              void space.prepare()
                .then(() => {
                  if (
                    controllerRef.current?.getPhase() === "SPACE"
                  ) {
                    spaceRef.current?.show();
                  }
                })
                .catch((error: unknown) => {
                  console.error(
                    "Could not show the space scene:",
                    error
                  );
                });
            }
          }

          if (phase === "IDLE") {
            spaceRef.current?.hide();
          }
        });

        return () => {
          unsubscribe();
          controller.destroy();
          controllerRef.current = null;
        };
      }, [dashboardElement, onPhaseChange]);

      useImperativeHandle(
        ref,
        () => ({
          startDeparture() {
            controllerRef.current?.startDeparture();
          },

          startReturn() {
            controllerRef.current?.startReturn();
          },

          stop() {
            controllerRef.current?.stop();
          },

          getPhase() {
            return (
              controllerRef.current?.getPhase() ?? "IDLE"
            );
          },
        }),
        []
      );

      return (
        <SpaceView
          ref={spaceRef}
          onReady={handleSpaceReady}
        />
      );
    }
  );

TransitionView.displayName = "TransitionView";
