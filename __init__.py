################
import matplotlib.pyplot as plt

for model in ["Incurred", "Rezerwy"]:

    dane = wyniki_zakresy[
        wyniki_zakresy["Model"] == model
    ]

    fig, ax = plt.subplots(figsize=(11, 5))

    for rozklad in ["normal", "gamma", "lognormal"]:

        d = dane[
            dane["Rozkład"] == rozklad
        ].sort_values("Max okres")

        ax.plot(
            d["Max okres"],
            d["p-value KS"],
            marker="o",
            label=rozklad
        )

    ax.axhline(
        y=0.05,
        color="red",
        linestyle="--",
        linewidth=1.5,
        label="Poziom istotności 0.05"
    )

    ax.set_title(f"{model} — p-value KS według zakresu rozwoju")
    ax.set_xlabel("Maksymalny okres rozwoju")
    ax.set_ylabel("p-value KS")
    ax.set_xticks(range(3, 22))
    ax.set_ylim(0, 1)
    ax.grid(alpha=0.3)
    ax.legend()

    plt.show()
