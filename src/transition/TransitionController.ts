export type TransitionPhase =
  | "IDLE"
  | "DEPARTURE"
  | "SPACE"
  | "RETURN";

interface DoorState {
  angle: number;
  velocity: number;
  target: number;
}

interface MotionState {
  x: number;
  y: number;
  velocityX: number;
  velocityY: number;
}

export class TransitionController {
  private phase: TransitionPhase =
    "IDLE";

  private dashboardElement: HTMLElement;

  private listeners =
    new Set<
      (phase: TransitionPhase) => void
    >();

  private root:
    HTMLDivElement | null = null;

  private leftDoor:
    HTMLDivElement | null = null;

  private rightDoor:
    HTMLDivElement | null = null;

  private portalGlow:
    HTMLDivElement | null = null;

  /*
   * Main opening angle.
   *
   * This is intentionally greater
   * than 90 degrees.
   */
  private readonly openAngle = 104;

  /*
   * While SPACE is active the
   * window must NEVER visually
   * close below this angle.
   */
  private readonly minimumSpaceAngle = 80;

  /*
   * Maximum physical movement caused
   * by space motion.
   */
  private readonly maximumSpaceAngle = 116;

  /*
   * Cursor position.
   */
  private pointerX = 0;
  private pointerY = 0;

  /*
   * Smoothed motion.
   */
  private motion: MotionState = {
    x: 0,
    y: 0,
    velocityX: 0,
    velocityY: 0,
  };

  private previousMotionX = 0;
  private previousMotionY = 0;

  /*
   * Random phase makes each transition
   * have slightly different physical
   * movement.
   */
  private motionPhase = 0;

  private leftState: DoorState = {
    angle: 0,
    velocity: 0,
    target: 0,
  };

  private rightState: DoorState = {
    angle: 0,
    velocity: 0,
    target: 0,
  };

  private animationFrame:
    number | null = null;

  private lastTime = 0;

  private departureTimer:
    number | null = null;

  private returnSafetyTimer:
    number | null = null;

  private pendingReturn = false;

  /*
   * Protects every transition from
   * stale timers/animation frames.
   */
  private transitionGeneration = 0;

  private handlePointerMove = (
    event: PointerEvent
  ) => {
    const width =
      Math.max(
        window.innerWidth,
        1
      );

    const height =
      Math.max(
        window.innerHeight,
        1
      );

    this.pointerX =
      (
        event.clientX /
        width
      ) *
        2 -
      1;

    this.pointerY =
      (
        event.clientY /
        height
      ) *
        2 -
      1;
  };

  private handleResize = () => {
    if (!this.root) {
      return;
    }

    this.syncGeometry();
  };

  constructor(
    dashboardElement: HTMLElement
  ) {
    this.dashboardElement =
      dashboardElement;
  }

  private setPhase(
    phase: TransitionPhase
  ) {
    this.phase = phase;

    this.listeners.forEach(
      (listener) => {
        listener(phase);
      }
    );
  }

  subscribe(
    listener: (
      phase: TransitionPhase
    ) => void
  ) {
    this.listeners.add(listener);

    return () =>
      this.listeners.delete(
        listener
      );
  }

  /*
   * =========================================================
   * DEPARTURE
   * =========================================================
   */

  startDeparture() {
    if (
      this.phase !== "IDLE"
    ) {
      return;
    }

    /*
     * Kill every previous transition.
     */
    this.transitionGeneration++;

    const generation =
      this.transitionGeneration;

    this.clearTimers();

    this.stopAnimation();

    this.removeDoors();

    this.pendingReturn = false;

    this.motionPhase =
      Math.random() *
      Math.PI *
      2;

    /*
     * Completely reset physical
     * state before creating the
     * new window.
     */
    this.leftState = {
      angle: 0,
      velocity: 0,
      target: this.openAngle,
    };

    this.rightState = {
      angle: 0,
      velocity: 0,
      target: -this.openAngle,
    };

    this.motion = {
      x: 0,
      y: 0,
      velocityX: 0,
      velocityY: 0,
    };

    this.previousMotionX = 0;
    this.previousMotionY = 0;

    /*
     * Create fresh doors.
     */
    this.createDoors();

    /*
     * Hide the real React dashboard.
     */
    this.dashboardElement.classList.add(
      "dashboard-transition-source"
    );

    this.setPhase(
      "DEPARTURE"
    );

    this.startAnimation();

    /*
     * Space is already visible
     * behind the opening during
     * this period.
     */
    this.departureTimer =
      window.setTimeout(
        () => {
          if (
            generation !==
            this.transitionGeneration
          ) {
            return;
          }

          this.enterSpace();
        },
        820
      );
  }

  private enterSpace() {
    if (
      this.phase !==
      "DEPARTURE"
    ) {
      return;
    }

    this.setPhase("SPACE");

    /*
     * If Mistral finished very
     * quickly during departure,
     * immediately begin the return.
     */
    if (
      this.pendingReturn
    ) {
      this.beginReturn();
    }
  }

  /*
   * =========================================================
   * RETURN
   * =========================================================
   */

  startReturn() {
    /*
     * If inference finished before
     * the window completely opened,
     * remember the request.
     */
    if (
      this.phase ===
      "DEPARTURE"
    ) {
      this.pendingReturn = true;
      return;
    }

    if (
      this.phase !== "SPACE"
    ) {
      return;
    }

    this.beginReturn();
  }

  private beginReturn() {
    if (
      this.phase !== "SPACE"
    ) {
      return;
    }

    const generation =
      this.transitionGeneration;

    this.pendingReturn = false;

    /*
     * IMPORTANT:
     *
     * From this point onward the
     * space-motion influence is
     * completely removed.
     *
     * The doors return from their
     * CURRENT physical position.
     */
    this.setPhase("RETURN");

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (
          generation !==
          this.transitionGeneration
        ) {
          return;
        }

        if (
          this.phase !== "RETURN"
        ) {
          return;
        }

        /*
         * Get the newest dashboard
         * state containing Mistral's
         * answer.
         */
        this.refreshDoorContent();

        /*
         * Exact physical reverse.
         */
        this.leftState.target = 0;

        this.rightState.target = 0;

        this.returnSafetyTimer =
          window.setTimeout(
            () => {
              if (
                generation !==
                this.transitionGeneration
              ) {
                return;
              }

              this.finishReturn();
            },
            1900
          );

        this.startAnimation();
      });
    });
  }

  /*
   * =========================================================
   * PHYSICAL WINDOW CREATION
   * =========================================================
   */

  private createDoors() {
    const root =
      document.createElement(
        "div"
      );

    root.className =
      "physical-transition-root";

    root.setAttribute(
      "aria-hidden",
      "true"
    );

    this.root = root;

    /*
     * Very subtle depth illumination
     * at the portal.
     */
    const portalGlow =
      document.createElement(
        "div"
      );

    portalGlow.className =
      "physical-portal-glow";

    this.portalGlow =
      portalGlow;

    /*
     * LEFT DOOR
     */
    const leftDoor =
      document.createElement(
        "div"
      );

    leftDoor.className =
      "physical-door physical-door-left";

    /*
     * RIGHT DOOR
     */
    const rightDoor =
      document.createElement(
        "div"
      );

    rightDoor.className =
      "physical-door physical-door-right";

    this.leftDoor =
      leftDoor;

    this.rightDoor =
      rightDoor;

    root.appendChild(
      portalGlow
    );

    root.appendChild(
      leftDoor
    );

    root.appendChild(
      rightDoor
    );

    document.body.appendChild(
      root
    );

    /*
     * Create the visual dashboard
     * copies before hiding the source.
     */
    this.refreshDoorContent();

    window.addEventListener(
      "pointermove",
      this.handlePointerMove,
      {
        passive: true,
      }
    );

    window.addEventListener(
      "resize",
      this.handleResize
    );

    this.syncGeometry();
  }

  private refreshDoorContent() {
    if (
      !this.leftDoor ||
      !this.rightDoor
    ) {
      return;
    }

    while (
      this.leftDoor.firstChild
    ) {
      this.leftDoor.removeChild(
        this.leftDoor.firstChild
      );
    }

    while (
      this.rightDoor.firstChild
    ) {
      this.rightDoor.removeChild(
        this.rightDoor.firstChild
      );
    }

    const leftClone =
      this.createDashboardClone();

    const rightClone =
      this.createDashboardClone();

    this.leftDoor.appendChild(
      leftClone
    );

    this.rightDoor.appendChild(
      rightClone
    );

    this.syncGeometry();
  }

  private createDashboardClone():
    HTMLElement {
    const clone =
      this.dashboardElement.cloneNode(
        true
      ) as HTMLElement;

    clone.classList.remove(
      "dashboard-transition-source",
      "dashboard-departing",
      "dashboard-in-space",
      "dashboard-returning"
    );

    /*
     * Remove duplicate IDs.
     */
    clone
      .querySelectorAll("[id]")
      .forEach(
        (element) => {
          element.removeAttribute(
            "id"
          );
        }
      );

    clone.setAttribute(
      "aria-hidden",
      "true"
    );

    clone.style.position =
      "absolute";

    clone.style.left =
      "0px";

    clone.style.top =
      "0px";

    clone.style.margin =
      "0";

    clone.style.transform =
      "none";

    clone.style.animation =
      "none";

    clone.style.visibility =
      "visible";

    clone.style.opacity =
      "1";

    clone.style.pointerEvents =
      "none";

    this.syncFormControls(
      this.dashboardElement,
      clone
    );

    return clone;
  }

  private syncFormControls(
    source: HTMLElement,
    clone: HTMLElement
  ) {
    const sourceControls =
      source.querySelectorAll(
        "input, textarea, select"
      );

    const cloneControls =
      clone.querySelectorAll(
        "input, textarea, select"
      );

    sourceControls.forEach(
      (
        sourceControl,
        index
      ) => {
        const cloneControl =
          cloneControls[
            index
          ] as
            | HTMLInputElement
            | HTMLTextAreaElement
            | HTMLSelectElement
            | undefined;

        if (!cloneControl) {
          return;
        }

        if (
          sourceControl instanceof
          HTMLInputElement
        ) {
          (
            cloneControl as HTMLInputElement
          ).value =
            sourceControl.value;
        }

        if (
          sourceControl instanceof
          HTMLTextAreaElement
        ) {
          (
            cloneControl as HTMLTextAreaElement
          ).value =
            sourceControl.value;
        }

        if (
          sourceControl instanceof
          HTMLSelectElement
        ) {
          (
            cloneControl as HTMLSelectElement
          ).selectedIndex =
            sourceControl.selectedIndex;
        }
      }
    );
  }

  /*
   * =========================================================
   * VIEWPORT GEOMETRY
   * =========================================================
   */

  private syncGeometry() {
    if (
      !this.root ||
      !this.leftDoor ||
      !this.rightDoor
    ) {
      return;
    }

    const width =
      Math.max(
        window.innerWidth,
        1
      );

    const height =
      Math.max(
        window.innerHeight,
        1
      );

    const halfWidth =
      width / 2;

    /*
     * LEFT DOOR
     *
     * HINGE = EXACTLY SCREEN LEFT
     */
    this.leftDoor.style.left =
      "0px";

    this.leftDoor.style.top =
      "0px";

    this.leftDoor.style.width =
      `${halfWidth}px`;

    this.leftDoor.style.height =
      `${height}px`;

    /*
     * RIGHT DOOR
     *
     * HINGE = EXACTLY SCREEN RIGHT
     */
    this.rightDoor.style.left =
      `${halfWidth}px`;

    this.rightDoor.style.top =
      "0px";

    this.rightDoor.style.width =
      `${halfWidth}px`;

    this.rightDoor.style.height =
      `${height}px`;

    const leftClone =
      this.leftDoor
        .firstElementChild as
        | HTMLElement
        | null;

    const rightClone =
      this.rightDoor
        .firstElementChild as
        | HTMLElement
        | null;

    /*
     * Full dashboard inside left
     * clipping container.
     */
    if (leftClone) {
      leftClone.style.width =
        `${width}px`;

      leftClone.style.height =
        `${height}px`;

      leftClone.style.left =
        "0px";

      leftClone.style.top =
        "0px";
    }

    /*
     * Full dashboard shifted so
     * only its right half appears.
     */
    if (rightClone) {
      rightClone.style.width =
        `${width}px`;

      rightClone.style.height =
        `${height}px`;

      rightClone.style.left =
        `${-halfWidth}px`;

      rightClone.style.top =
        "0px";
    }
  }

  /*
   * =========================================================
   * ANIMATION LOOP
   * =========================================================
   */

  private startAnimation() {
    if (
      this.animationFrame !==
      null
    ) {
      return;
    }

    this.lastTime =
      performance.now();

    this.animationFrame =
      requestAnimationFrame(
        this.tick
      );
  }

  private stopAnimation() {
    if (
      this.animationFrame !==
      null
    ) {
      cancelAnimationFrame(
        this.animationFrame
      );

      this.animationFrame =
        null;
    }
  }

  private tick = (
    currentTime: number
  ) => {
    const delta =
      Math.min(
        0.032,
        Math.max(
          0.001,
          (
            currentTime -
            this.lastTime
          ) / 1000
        )
      );

    this.lastTime =
      currentTime;

    /*
     * Physical spring motion.
     */
    this.leftState =
      this.integrateDoor(
        this.leftState,
        delta
      );

    this.rightState =
      this.integrateDoor(
        this.rightState,
        delta
      );

    /*
     * Read movement from the
     * same pointer controlling
     * the space.
     */
    this.updateSpaceMotion(
      delta
    );

    /*
     * Apply physical window
     * movement.
     */
    this.renderDoors(
      currentTime / 1000
    );

    /*
     * RETURN FINISH CONDITION
     *
     * Both doors must physically
     * settle at exactly zero.
     */
    if (
      this.phase ===
        "RETURN" &&
      Math.abs(
        this.leftState.angle
      ) < 0.1 &&
      Math.abs(
        this.rightState.angle
      ) < 0.1 &&
      Math.abs(
        this.leftState.velocity
      ) < 0.35 &&
      Math.abs(
        this.rightState.velocity
      ) < 0.35
    ) {
      this.finishReturn();
      return;
    }

    if (
      this.phase === "IDLE"
    ) {
      this.animationFrame =
        null;

      return;
    }

    this.animationFrame =
      requestAnimationFrame(
        this.tick
      );
  };

  /*
   * =========================================================
   * SPACE MOTION
   * =========================================================
   */

  private updateSpaceMotion(
    delta: number
  ) {
    /*
     * During RETURN we deliberately
     * stop feeding space motion into
     * the door.
     *
     * This guarantees a seamless
     * return to zero.
     */
    if (
      this.phase === "RETURN"
    ) {
      this.motion.velocityX *=
        Math.exp(
          -12 * delta
        );

      this.motion.velocityY *=
        Math.exp(
          -12 * delta
        );

      return;
    }

    /*
     * Smooth pointer position.
     */
    this.motion.x +=
      (
        this.pointerX -
        this.motion.x
      ) *
      Math.min(
        delta * 8,
        1
      );

    this.motion.y +=
      (
        this.pointerY -
        this.motion.y
      ) *
      Math.min(
        delta * 8,
        1
      );

    /*
     * Calculate actual pointer
     * movement velocity.
     */
    const velocityX =
      (
        this.motion.x -
        this.previousMotionX
      ) /
      delta;

    const velocityY =
      (
        this.motion.y -
        this.previousMotionY
      ) /
      delta;

    this.previousMotionX =
      this.motion.x;

    this.previousMotionY =
      this.motion.y;

    /*
     * Smooth the velocity.
     */
    this.motion.velocityX +=
      (
        velocityX -
        this.motion.velocityX
      ) *
      Math.min(
        delta * 10,
        1
      );

    this.motion.velocityY +=
      (
        velocityY -
        this.motion.velocityY
      ) *
      Math.min(
        delta * 10,
        1
      );

    /*
     * Prevent huge mouse jumps
     * from throwing the window.
     */
    this.motion.velocityX =
      Math.max(
        -3.5,
        Math.min(
          3.5,
          this.motion.velocityX
        )
      );

    this.motion.velocityY =
      Math.max(
        -3.5,
        Math.min(
          3.5,
          this.motion.velocityY
        )
      );
  }

  /*
   * =========================================================
   * SPRING PHYSICS
   * =========================================================
   */

  private integrateDoor(
    state: DoorState,
    delta: number
  ): DoorState {
    /*
     * During SPACE the target stays
     * around the >90° open position.
     *
     * During RETURN target = 0.
     */
    let target =
      state.target;

    if (
      this.phase === "SPACE"
    ) {
      /*
       * Never allow the physical
       * target itself below 80°.
       */
      if (
        state.target > 0
      ) {
        target =
          Math.max(
            this.minimumSpaceAngle,
            state.target
          );
      } else {
        target =
          Math.min(
            -this.minimumSpaceAngle,
            state.target
          );
      }
    }

    const stiffness =
      this.phase === "RETURN"
        ? 165
        : 145;

    const damping =
      this.phase === "RETURN"
        ? 21
        : 19;

    const force =
      (
        target -
        state.angle
      ) *
      stiffness;

    let velocity =
      state.velocity +
      force *
      delta;

    velocity *=
      Math.exp(
        -damping *
        delta
      );

    const angle =
      state.angle +
      velocity *
      delta;

    return {
      angle,
      velocity,
      target: state.target,
    };
  }

  /*
   * =========================================================
   * RENDER PHYSICAL WINDOW
   * =========================================================
   */

  private renderDoors(
    time: number
  ) {
    if (
      !this.leftDoor ||
      !this.rightDoor
    ) {
      return;
    }

    /*
     * -------------------------------------------------------
     * SPACE MOTION INFLUENCE
     * -------------------------------------------------------
     */

    let motionAngle = 0;

    if (this.phase === "SPACE") {
      // Horizontal pointer position gently adjusts the gate angle.
      const positionInfluence = this.motion.x * 1.8;

      // Keep only a small amount of horizontal inertia so quick
      // pointer movements cannot throw the gate around violently.
      const velocityInfluence = this.motion.velocityX * 0.65;

      motionAngle = positionInfluence + velocityInfluence;

      // Limit the extra gate movement to a subtle, controlled range.
      motionAngle = Math.max(-4, Math.min(4, motionAngle));
    }

    /*
     * -------------------------------------------------------
     * GUARANTEE 80°–116° DURING SPACE
     * -------------------------------------------------------
     */

    let leftOpenAngle =
      Math.abs(
        this.leftState.angle
      );

    let rightOpenAngle =
      Math.abs(
        this.rightState.angle
      );

    if (
      this.phase === "SPACE"
    ) {
      leftOpenAngle =
        Math.max(
          this.minimumSpaceAngle,
          Math.min(
            this.maximumSpaceAngle,
            leftOpenAngle +
              motionAngle
          )
        );

      rightOpenAngle =
        Math.max(
          this.minimumSpaceAngle,
          Math.min(
            this.maximumSpaceAngle,
            rightOpenAngle +
              motionAngle
          )
        );
    }

    /*
     * -------------------------------------------------------
     * VERY SMALL NATURAL MOVEMENT
     * -------------------------------------------------------
     */

    const ambient =
      this.phase === "SPACE"
        ? Math.sin(
            time * 0.45 +
              this.motionPhase
          ) *
          0.35
        : 0;

    /*
     * -------------------------------------------------------
     * LEFT DOOR
     * -------------------------------------------------------
     *
     * Positive Y rotation.
     */
    let leftRotation =
      this.phase === "SPACE"
        ? leftOpenAngle
        : this.leftState.angle;

    /*
     * -------------------------------------------------------
     * RIGHT DOOR
     * -------------------------------------------------------
     *
     * Negative Y rotation.
     */
    let rightRotation =
      this.phase === "SPACE"
        ? -rightOpenAngle
        : this.rightState.angle;

    if (
      this.phase === "SPACE"
    ) {
      leftRotation +=
        ambient;

      rightRotation -=
        ambient;
    }

    /*
     * -------------------------------------------------------
     * APPLY TRANSFORMS
     * -------------------------------------------------------
     * Gate movement is horizontal only. No rotateX is applied,
     * so pointer height cannot tilt the doors vertically.
     */

    this.leftDoor.style.transform =
      `rotateY(${leftRotation}deg)`;

    this.rightDoor.style.transform =
      `rotateY(${rightRotation}deg)`;

    /*
     * Portal illumination responds
     * very slightly to movement.
     */
    if (
      this.portalGlow
    ) {
      const progress =
        Math.min(
          1,
          Math.max(
            leftOpenAngle,
            rightOpenAngle
          ) /
            this.openAngle
        );

      const motionEnergy =
        Math.min(
          1,
          Math.abs(
            this.motion.velocityX
          ) +
            Math.abs(
              this.motion.velocityY
            )
        );

      this.portalGlow.style.opacity =
        String(
          progress *
            (
              0.08 +
              motionEnergy *
                0.04
            )
        );
    }
  }

  /*
   * =========================================================
   * FINISH
   * =========================================================
   */

  private finishReturn() {
    if (
      this.phase !== "RETURN"
    ) {
      return;
    }

    this.clearTimers();

    this.stopAnimation();

    /*
     * Force exact closed state.
     */
    this.leftState = {
      angle: 0,
      velocity: 0,
      target: 0,
    };

    this.rightState = {
      angle: 0,
      velocity: 0,
      target: 0,
    };

    /*
     * Remove physical doors FIRST.
     */
    this.removeDoors();

    /*
     * Then reveal the actual
     * React dashboard.
     */
    this.dashboardElement.classList.remove(
      "dashboard-transition-source"
    );

    this.setPhase("IDLE");
  }

  private clearTimers() {
    if (
      this.departureTimer !==
      null
    ) {
      window.clearTimeout(
        this.departureTimer
      );

      this.departureTimer =
        null;
    }

    if (
      this.returnSafetyTimer !==
      null
    ) {
      window.clearTimeout(
        this.returnSafetyTimer
      );

      this.returnSafetyTimer =
        null;
    }
  }

  private removeDoors() {
    window.removeEventListener(
      "pointermove",
      this.handlePointerMove
    );

    window.removeEventListener(
      "resize",
      this.handleResize
    );

    if (
      this.root &&
      this.root.parentNode
    ) {
      this.root.parentNode.removeChild(
        this.root
      );
    }

    this.root = null;

    this.leftDoor = null;

    this.rightDoor = null;

    this.portalGlow = null;
  }

  stop() {
    this.transitionGeneration++;

    this.clearTimers();

    this.stopAnimation();

    this.pendingReturn = false;

    this.removeDoors();

    this.leftState = {
      angle: 0,
      velocity: 0,
      target: 0,
    };

    this.rightState = {
      angle: 0,
      velocity: 0,
      target: 0,
    };

    this.dashboardElement.classList.remove(
      "dashboard-transition-source"
    );

    this.setPhase("IDLE");
  }

  getPhase(): TransitionPhase {
    return this.phase;
  }

  destroy() {
    this.stop();

    this.listeners.clear();
  }
}