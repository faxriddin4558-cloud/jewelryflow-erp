import { type NextRequest, NextResponse } from "next/server";
import { supabase } from "@/lib/erp-engine";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { linkCode, telegramUserId, telegramUsername, ip, userAgent } = body;

    if (!linkCode || !telegramUserId) {
      return NextResponse.json(
        { success: false, error: "Tasdiqlash kodi va Telegram ID kiritilishi shart." },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.rpc("rpc_verify_and_link_telegram", {
      p_link_code: String(linkCode).trim(),
      p_telegram_user_id: String(telegramUserId).trim(),
      p_telegram_username: telegramUsername ? String(telegramUsername).trim() : null,
    });

    if (error) {
      return NextResponse.json(
        { success: false, error: error.message },
        { status: 400 }
      );
    }

    // Role-based target routing
    const roleLower = String(data.role || "").toLowerCase();
    let redirectUrl = "/sales/app";
    if (roleLower === "seller" || roleLower === "sales") {
      redirectUrl = "/sales/mobile";
    }

    // Record login audit
    await supabase.rpc("rpc_record_login_audit", {
      p_employee_id: data.employee_id,
      p_email: data.email,
      p_role: String(data.role),
      p_login_method: "telegram_linked",
      p_telegram_user_id: String(telegramUserId),
      p_status: "success",
      p_failure_reason: null,
      p_ip: ip || req.headers.get("x-forwarded-for") || null,
      p_user_agent: userAgent || req.headers.get("user-agent") || null,
    });

    return NextResponse.json({
      success: true,
      data,
      redirectUrl,
      message: "Telegram hisobi muvaffaqiyatli ulandi!",
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { success: false, error: "Server xatoligi: " + msg },
      { status: 500 }
    );
  }
}
