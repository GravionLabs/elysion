using System.ComponentModel.DataAnnotations;

namespace Elysion.BusinessBackend.Api.Audit;

/// <summary>How long the audit log keeps its entries (#669). Bound from the configuration setting <c>AUDIT_RETENTION_DAYS</c>.</summary>
public sealed class AuditOptions
{
    public const string RetentionDaysSetting = "AUDIT_RETENTION_DAYS";
    public const int DefaultRetentionDays = 365;

    [Range(1, 36_500)]
    public int RetentionDays { get; set; } = DefaultRetentionDays;
}
