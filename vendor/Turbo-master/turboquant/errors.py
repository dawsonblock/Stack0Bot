"""
Custom typed errors for TurboQuant to make runtime failures debuggable and testable.
"""


class TurboQuantError(Exception):
    """Base class for all TurboQuant errors."""

    pass


class TurboQuantConfigError(TurboQuantError, ValueError):
    """Raised when the configuration is invalid."""

    pass


class TurboQuantShapeError(TurboQuantError, ValueError):
    """Raised when tensor shapes or dimensions are incompatible or invalid."""

    pass


class TurboQuantStateError(TurboQuantError, ValueError):
    """Raised when there is an issue with saving, loading, or corrupt state."""

    pass


class TurboQuantKernelError(TurboQuantError, RuntimeError):
    """Raised when a fused kernel fails or is unsupported for the parameters."""

    pass


class TurboQuantCompatibilityError(TurboQuantError, TypeError):
    """Raised when there is an issue with mlx_lm upstream compatibility or adapter drift."""

    pass


class UnsupportedModelError(TurboQuantError, ValueError):
    """Raised when a model family is not in the supported allowlist.

    TurboQuant formally supports Llama and Gemma only.  Any other model
    family must not be passed through the production upgrade path.
    """

    pass
