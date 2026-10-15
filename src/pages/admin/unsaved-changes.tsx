import { useNavigationGuard } from "@fluojs/react/client";
import { useEffect, useId, useRef } from "react";
import { admin } from "./styles";

type UnsavedChangesProps = {
  dirty: boolean;
  pending: boolean;
};

export function UnsavedChanges({ dirty, pending }: UnsavedChangesProps) {
  const decision = useNavigationGuard({
    when: dirty || pending,
    beforeUnload: true,
  });
  const statusId = useId();
  const stayButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (decision) stayButton.current?.focus();
  }, [decision]);

  return (
    <>
      <p
        className={dirty || pending ? admin.note : "sr-only"}
        id={statusId}
        role="status"
      >
        {pending
          ? "처리 중인 작업이 있어요. 이동해도 이미 요청한 작업은 취소되지 않으며, 결과를 확인하지 못할 수 있어요."
          : dirty
            ? "저장하지 않은 입력이 있어요. 이 페이지를 떠나면 입력한 내용이 사라져요."
            : ""}
      </p>
      {decision ? (
        <section
          aria-describedby={statusId}
          aria-label="페이지 이동 확인"
          className="my-4 rounded-[10px] border border-[var(--admin-panel-border)] bg-[var(--admin-input-bg)] p-4"
        >
          <strong>페이지를 이동할까요?</strong>
          {pending && dirty ? (
            <p className={admin.note}>저장하지 않은 입력도 사라져요.</p>
          ) : null}
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              className={`${admin.button} admin-button`}
              onClick={decision.stay}
              ref={stayButton}
              type="button"
            >
              계속 작성하기
            </button>
            <button
              className={`${admin.button} ${admin.ghost} admin-button`}
              onClick={decision.proceed}
              type="button"
            >
              저장하지 않고 이동
            </button>
          </div>
        </section>
      ) : null}
    </>
  );
}
