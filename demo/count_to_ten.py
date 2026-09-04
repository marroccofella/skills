"""Count from 1 to 10 (momm end-to-end verification program)."""


def count_to_ten():
    return list(range(1, 11))


if __name__ == "__main__":
    for number in count_to_ten():
        print(number)
